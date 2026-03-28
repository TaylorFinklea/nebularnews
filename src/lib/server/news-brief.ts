import { nanoid } from 'nanoid';
import { DateTime } from 'luxon';
import { dbAll, dbGet, dbRun, now, type Db } from './db';
import { generateNewsBrief as generateNewsBriefLlm } from './llm';
import { logInfo } from './log';
import {
  getFeatureProviderModel,
  getNewsBriefConfig,
  getNewsBriefConfigForUser,
  getProviderKey,
  type NewsBriefConfig,
  type ReasoningEffort
} from './settings';
import { getPreferredSourcesForArticles } from './sources';

export const NEWS_BRIEF_TITLE = 'News Brief';
export const NEWS_BRIEF_MAX_CANDIDATES = 20;
export const NEWS_BRIEF_MAX_BULLETS = 5;
export const NEWS_BRIEF_MAX_SOURCES_PER_BULLET = 1;

const MAX_NEWS_BRIEF_ATTEMPTS = 3;
const NEWS_BRIEF_LEASE_MS = 1000 * 60 * 3;
const MAX_BACKOFF_MS = 1000 * 60 * 60;

export type NewsBriefEditionSlot = 'morning' | 'evening' | 'manual';
export type NewsBriefEditionKind = 'scheduled' | 'manual';
export type NewsBriefEditionStatus = 'pending' | 'running' | 'ready' | 'empty' | 'failed';

export type NewsBriefBullet = {
  text: string;
  sources: Array<{
    articleId: string;
    title: string;
    canonicalUrl: string | null;
  }>;
};

export type NewsBriefCandidate = {
  articleId: string;
  title: string | null;
  canonicalUrl: string | null;
  publishedAt: number | null;
  fetchedAt: number | null;
  effectiveScore: number;
  sourceName: string | null;
  context: string;
};

type NewsBriefCandidateRow = {
  article_id: string;
  title: string | null;
  canonical_url: string | null;
  published_at: number | null;
  fetched_at: number | null;
  excerpt: string | null;
  content_text: string | null;
  summary_text: string | null;
  key_points_json: string | null;
  effective_score: number | null;
};

type PersistedNewsBriefEdition = {
  id: string;
  user_id: string;
  edition_key: string;
  edition_kind: NewsBriefEditionKind;
  edition_slot: NewsBriefEditionSlot;
  timezone: string;
  scheduled_for: number | null;
  window_start: number;
  window_end: number;
  score_cutoff: number;
  status: NewsBriefEditionStatus;
  candidate_count: number;
  bullets_json: string;
  source_article_ids_json: string;
  provider: string | null;
  model: string | null;
  last_error: string | null;
  attempts: number;
  run_after: number;
  generated_at: number | null;
  created_at: number;
  updated_at: number;
};

type QueuedNewsBriefSlot = {
  editionKey: string;
  slot: Exclude<NewsBriefEditionSlot, 'manual'>;
  scheduledFor: number;
  windowStart: number;
  windowEnd: number;
};

type NewsBriefGenerationContext = {
  config: NewsBriefConfig;
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  apiKey: string | null;
};

export type NewsBriefEditionSummary = {
  id: string;
  status: NewsBriefEditionStatus;
  editionLabel: string;
  generatedAt: number | null;
  candidateCount: number;
  updatedAt: number;
};

export type DashboardNewsBriefState = {
  state: 'ready' | 'empty' | 'pending' | 'unavailable';
  title: string;
  editionLabel: string;
  generatedAt: number | null;
  windowHours: number;
  scoreCutoff: number;
  bullets: NewsBriefBullet[];
  nextScheduledAt: number | null;
  stale: boolean;
};

export type NewsBriefQueueSummary = {
  providerReady: boolean;
  queuedCount: number;
  dueCount: number;
  processedCount: number;
  readyCount: number;
  emptyCount: number;
  failedCount: number;
};

export const getNewsBriefEnabledUserIds = async (db: Db): Promise<string[]> => {
  const rows = await dbAll<{ user_id: string }>(
    db,
    `SELECT DISTINCT user_id FROM settings WHERE key = 'news_brief_enabled' AND value = '1'`
  );
  // If no users have the setting explicitly, fall back to admin (backward compat)
  if (rows.length === 0) return ['admin'];
  return rows.map((row) => row.user_id);
};

const getAffectedRows = (result: unknown) => {
  const cast = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(cast?.meta?.changes ?? cast?.changes ?? 0);
};

const computeRetryDelayMs = (attempts: number) => {
  const exponential = 1000 * 60 * 2 ** Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, exponential);
};

const parseKeyPoints = (value: string | null) => {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
};

const truncate = (value: string | null | undefined, maxLength: number) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
};

const buildCandidateContext = (row: NewsBriefCandidateRow) => {
  const keyPoints = parseKeyPoints(row.key_points_json);
  if (keyPoints.length > 0) {
    return keyPoints.join(' | ');
  }
  if (row.summary_text?.trim()) return row.summary_text.trim();
  if (row.excerpt?.trim()) return row.excerpt.trim();
  return truncate(row.content_text, 1200);
};

const parseTimeParts = (value: string) => {
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  return {
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0
  };
};

const getEditionLabel = (slot: NewsBriefEditionSlot) => {
  if (slot === 'morning') return 'Morning edition';
  if (slot === 'evening') return 'Evening edition';
  return 'Manual update';
};

const getEditionTimestamp = (edition: Pick<PersistedNewsBriefEdition, 'generated_at' | 'scheduled_for' | 'created_at'>) =>
  edition.generated_at ?? edition.scheduled_for ?? edition.created_at;

const parseBullets = (value: string | null | undefined) => {
  if (!value) return [] as NewsBriefBullet[];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const row = entry as {
          text?: unknown;
          sources?: Array<{ articleId?: unknown; title?: unknown; canonicalUrl?: unknown }>;
        };
        const text = String(row.text ?? '').trim();
        const source = Array.isArray(row.sources) ? row.sources[0] : null;
        const articleId = String(source?.articleId ?? '').trim();
        const title = String(source?.title ?? '').trim();
        if (!text || !articleId || !title) return null;
        return {
          text,
          sources: [
            {
              articleId,
              title,
              canonicalUrl: source?.canonicalUrl ? String(source.canonicalUrl) : null
            }
          ]
        } satisfies NewsBriefBullet;
      })
      .filter(Boolean) as NewsBriefBullet[];
  } catch {
    return [];
  }
};

const flattenSourceArticleIds = (bullets: NewsBriefBullet[]) => {
  const ids = new Set<string>();
  for (const bullet of bullets) {
    for (const source of bullet.sources) {
      ids.add(source.articleId);
    }
  }
  return [...ids];
};

const buildScheduledEditionKey = (
  timezone: string,
  dateKey: string,
  slot: Exclude<NewsBriefEditionSlot, 'manual'>
) => `scheduled:${timezone}:${dateKey}:${slot}`;

export const getDueNewsBriefSlots = (config: NewsBriefConfig, referenceAt = Date.now()): QueuedNewsBriefSlot[] => {
  const nowLocal = DateTime.fromMillis(referenceAt, { zone: config.timezone });
  const morning = parseTimeParts(config.morningTime);
  const evening = parseTimeParts(config.eveningTime);
  const days = [nowLocal.minus({ days: 1 }).startOf('day'), nowLocal.startOf('day')];
  const dueSlots: QueuedNewsBriefSlot[] = [];

  for (const day of days) {
    const morningSlot = day.set({ hour: morning.hours, minute: morning.minutes, second: 0, millisecond: 0 });
    const eveningSlot = day.set({ hour: evening.hours, minute: evening.minutes, second: 0, millisecond: 0 });
    const slots = [
      { slot: 'morning' as const, at: morningSlot },
      { slot: 'evening' as const, at: eveningSlot }
    ];

    for (const candidate of slots) {
      if (candidate.at.toMillis() > referenceAt) continue;
      dueSlots.push({
        editionKey: buildScheduledEditionKey(config.timezone, candidate.at.toFormat('yyyy-MM-dd'), candidate.slot),
        slot: candidate.slot,
        scheduledFor: candidate.at.toMillis(),
        windowStart: candidate.at.minus({ hours: config.lookbackHours }).toMillis(),
        windowEnd: candidate.at.toMillis()
      });
    }
  }

  return dueSlots.sort((a, b) => a.scheduledFor - b.scheduledFor);
};

export const getLatestDueNewsBriefSlot = (config: NewsBriefConfig, referenceAt = Date.now()) => {
  const due = getDueNewsBriefSlots(config, referenceAt);
  return due.length > 0 ? due[due.length - 1] : null;
};

export const getNextScheduledNewsBriefAt = (config: NewsBriefConfig, referenceAt = Date.now()) => {
  const nowLocal = DateTime.fromMillis(referenceAt, { zone: config.timezone });
  const morning = parseTimeParts(config.morningTime);
  const evening = parseTimeParts(config.eveningTime);
  const todayMorning = nowLocal.startOf('day').set({
    hour: morning.hours,
    minute: morning.minutes,
    second: 0,
    millisecond: 0
  });
  const todayEvening = nowLocal.startOf('day').set({
    hour: evening.hours,
    minute: evening.minutes,
    second: 0,
    millisecond: 0
  });

  if (referenceAt < todayMorning.toMillis()) return todayMorning.toMillis();
  if (referenceAt < todayEvening.toMillis()) return todayEvening.toMillis();

  return nowLocal
    .plus({ days: 1 })
    .startOf('day')
    .set({ hour: morning.hours, minute: morning.minutes, second: 0, millisecond: 0 })
    .toMillis();
};

export async function resolveNewsBriefGenerationContext(
  db: Db,
  env: App.Platform['env'],
  userId?: string
): Promise<NewsBriefGenerationContext> {
  const config = userId
    ? await getNewsBriefConfigForUser(db, userId)
    : await getNewsBriefConfig(db);
  const { provider, model, reasoningEffort } = await getFeatureProviderModel(db, env, 'summaries');
  const apiKey = await getProviderKey(db, env, provider);
  return { config, provider, model, reasoningEffort, apiKey };
}

export async function listNewsBriefCandidates(
  db: Db,
  config: Pick<NewsBriefConfig, 'scoreCutoff'>,
  windowStart: number,
  windowEnd: number,
  userId?: string
): Promise<NewsBriefCandidate[]> {
  const subscriptionFilter = userId
    ? `AND EXISTS (
         SELECT 1 FROM article_sources src
         JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
         WHERE src.article_id = a.id AND ufs.user_id = ?
       )`
    : '';
  const params: (string | number)[] = [windowStart, windowEnd];
  if (userId) params.push(userId);

  const rows = await dbAll<NewsBriefCandidateRow>(
    db,
    `WITH latest_scores AS (
       SELECT sc.article_id, sc.score, sc.score_status
       FROM article_scores sc
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_scores
         GROUP BY article_id
       ) latest
         ON latest.article_id = sc.article_id
        AND latest.created_at = sc.created_at
     ),
     latest_summaries AS (
       SELECT s.article_id, s.summary_text
       FROM article_summaries s
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_summaries
         GROUP BY article_id
       ) latest
         ON latest.article_id = s.article_id
        AND latest.created_at = s.created_at
     ),
     latest_key_points AS (
       SELECT kp.article_id, kp.key_points_json
       FROM article_key_points kp
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_key_points
         GROUP BY article_id
       ) latest
         ON latest.article_id = kp.article_id
        AND latest.created_at = kp.created_at
     ),
     candidate_rows AS (
       SELECT
         a.id as article_id,
         a.title,
         a.canonical_url,
         a.published_at,
         a.fetched_at,
         a.excerpt,
         a.content_text,
         ls.summary_text,
         lkp.key_points_json,
         COALESCE(
           o.score,
           CASE WHEN lsc.score_status = 'ready' THEN lsc.score ELSE NULL END
         ) as effective_score
       FROM articles a
       LEFT JOIN latest_scores lsc ON lsc.article_id = a.id
       LEFT JOIN latest_summaries ls ON ls.article_id = a.id
       LEFT JOIN latest_key_points lkp ON lkp.article_id = a.id
       LEFT JOIN article_score_overrides o ON o.article_id = a.id
       WHERE COALESCE(a.published_at, a.fetched_at, 0) >= ?
         AND COALESCE(a.published_at, a.fetched_at, 0) < ?
         ${subscriptionFilter}
     )
     SELECT
       article_id,
       title,
       canonical_url,
       published_at,
       fetched_at,
       excerpt,
       content_text,
       summary_text,
       key_points_json,
       effective_score
     FROM candidate_rows
     WHERE effective_score >= ?
     ORDER BY effective_score DESC, COALESCE(published_at, fetched_at, 0) DESC
     LIMIT ?`,
    [...params, config.scoreCutoff, NEWS_BRIEF_MAX_CANDIDATES * 3]
  );

  const sourceByArticle = await getPreferredSourcesForArticles(
    db,
    rows.map((row) => row.article_id)
  );

  const seenCanonicalUrls = new Set<string>();
  const candidates: NewsBriefCandidate[] = [];

  for (const row of rows) {
    const canonicalUrl = row.canonical_url?.trim() || null;
    if (canonicalUrl) {
      if (seenCanonicalUrls.has(canonicalUrl)) continue;
      seenCanonicalUrls.add(canonicalUrl);
    }

    candidates.push({
      articleId: row.article_id,
      title: row.title,
      canonicalUrl,
      publishedAt: row.published_at,
      fetchedAt: row.fetched_at,
      effectiveScore: Number(row.effective_score ?? 0),
      sourceName: sourceByArticle.get(row.article_id)?.sourceName ?? null,
      context: buildCandidateContext(row)
    });

    if (candidates.length >= NEWS_BRIEF_MAX_CANDIDATES) break;
  }

  return candidates;
}

const insertEdition = async (
  db: Db,
  input: {
    userId: string;
    editionKey: string;
    editionKind: NewsBriefEditionKind;
    editionSlot: NewsBriefEditionSlot;
    timezone: string;
    scheduledFor: number | null;
    windowStart: number;
    windowEnd: number;
    scoreCutoff: number;
    runAfter: number;
  }
) => {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO news_brief_editions (
      id,
      user_id,
      edition_key,
      edition_kind,
      edition_slot,
      timezone,
      scheduled_for,
      window_start,
      window_end,
      score_cutoff,
      status,
      candidate_count,
      bullets_json,
      source_article_ids_json,
      provider,
      model,
      last_error,
      attempts,
      locked_by,
      locked_at,
      lease_expires_at,
      run_after,
      generated_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '[]', '[]', NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, NULL, ?, ?) ON CONFLICT DO NOTHING`,
    [
      nanoid(),
      input.userId,
      input.editionKey,
      input.editionKind,
      input.editionSlot,
      input.timezone,
      input.scheduledFor,
      input.windowStart,
      input.windowEnd,
      input.scoreCutoff,
      input.runAfter,
      timestamp,
      timestamp
    ]
  );
};

export async function createManualNewsBriefEdition(db: Db, config: NewsBriefConfig, referenceAt = now(), userId = 'admin') {
  const editionKey = `manual:${userId}:${referenceAt}:${nanoid()}`;
  await insertEdition(db, {
    userId,
    editionKey,
    editionKind: 'manual',
    editionSlot: 'manual',
    timezone: config.timezone,
    scheduledFor: null,
    windowStart: referenceAt - config.lookbackHours * 60 * 60 * 1000,
    windowEnd: referenceAt,
    scoreCutoff: config.scoreCutoff,
    runAfter: referenceAt
  });

  const row = await dbGet<{ id: string }>(
    db,
    'SELECT id FROM news_brief_editions WHERE edition_key = ? LIMIT 1',
    [editionKey]
  );
  return row?.id ?? null;
}

export async function queueDueNewsBriefEditionsForUser(
  db: Db,
  env: App.Platform['env'],
  userId: string,
  referenceAt = now()
) {
  const context = await resolveNewsBriefGenerationContext(db, env, userId);
  if (!context.config.enabled || !context.apiKey) {
    return {
      providerReady: Boolean(context.apiKey),
      queuedCount: 0,
      dueCount: 0
    };
  }

  const dueSlots = getDueNewsBriefSlots(context.config, referenceAt);
  const editionKeys: string[] = [];
  for (const slot of dueSlots) {
    const editionKey = `${userId}:${slot.editionKey}`;
    editionKeys.push(editionKey);
    await insertEdition(db, {
      userId,
      editionKey,
      editionKind: 'scheduled',
      editionSlot: slot.slot,
      timezone: context.config.timezone,
      scheduledFor: slot.scheduledFor,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      scoreCutoff: context.config.scoreCutoff,
      runAfter: slot.scheduledFor
    });
  }

  const rows = await dbAll<{ edition_key: string }>(
    db,
    `SELECT edition_key
     FROM news_brief_editions
     WHERE edition_key IN (${new Array(editionKeys.length || 1).fill('?').join(', ')})`,
    editionKeys.length > 0 ? editionKeys : ['']
  );

  return {
    providerReady: true,
    queuedCount: rows.length,
    dueCount: dueSlots.length
  };
}

export async function queueDueNewsBriefEditions(
  db: Db,
  env: App.Platform['env'],
  referenceAt = now()
) {
  const userIds = await getNewsBriefEnabledUserIds(db);
  let totalQueued = 0;
  let totalDue = 0;
  let providerReady = true;

  for (const userId of userIds) {
    const result = await queueDueNewsBriefEditionsForUser(db, env, userId, referenceAt);
    totalQueued += result.queuedCount;
    totalDue += result.dueCount;
    if (!result.providerReady) providerReady = false;
  }

  return {
    providerReady,
    queuedCount: totalQueued,
    dueCount: totalDue
  };
}

const loadEditionById = async (db: Db, editionId: string) =>
  dbGet<PersistedNewsBriefEdition>(
    db,
    `SELECT
      id,
      user_id,
      edition_key,
      edition_kind,
      edition_slot,
      timezone,
      scheduled_for,
      window_start,
      window_end,
      score_cutoff,
      status,
      candidate_count,
      bullets_json,
      source_article_ids_json,
      provider,
      model,
      last_error,
      attempts,
      run_after,
      generated_at,
      created_at,
      updated_at
     FROM news_brief_editions
     WHERE id = ?
     LIMIT 1`,
    [editionId]
  );

const claimEdition = async (db: Db, editionId: string, processorId: string) => {
  const lockTimestamp = now();
  const result = await dbRun(
    db,
    `UPDATE news_brief_editions
     SET status = 'running',
         locked_by = ?,
         locked_at = ?,
         lease_expires_at = ?,
         updated_at = ?
     WHERE id = ?
       AND status = 'pending'
       AND run_after <= ?`,
    [processorId, lockTimestamp, lockTimestamp + NEWS_BRIEF_LEASE_MS, lockTimestamp, editionId, lockTimestamp]
  );
  return getAffectedRows(result) > 0;
};

const completeEdition = async (
  db: Db,
  editionId: string,
  payload: {
    status: Extract<NewsBriefEditionStatus, 'ready' | 'empty'>;
    candidateCount: number;
    bullets: NewsBriefBullet[];
    provider: string | null;
    model: string | null;
  }
) => {
  const timestamp = now();
  await dbRun(
    db,
    `UPDATE news_brief_editions
     SET status = ?,
         candidate_count = ?,
         bullets_json = ?,
         source_article_ids_json = ?,
         provider = ?,
         model = ?,
         last_error = NULL,
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         generated_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      payload.status,
      payload.candidateCount,
      JSON.stringify(payload.bullets),
      JSON.stringify(flattenSourceArticleIds(payload.bullets)),
      payload.provider,
      payload.model,
      timestamp,
      timestamp,
      editionId
    ]
  );
};

const failEdition = async (db: Db, edition: PersistedNewsBriefEdition, errorMessage: string) => {
  const attempt = edition.attempts + 1;
  const status: NewsBriefEditionStatus = attempt >= MAX_NEWS_BRIEF_ATTEMPTS ? 'failed' : 'pending';
  const retryAt = status === 'failed' ? edition.run_after : now() + computeRetryDelayMs(attempt);
  const timestamp = now();
  await dbRun(
    db,
    `UPDATE news_brief_editions
     SET status = ?,
         attempts = ?,
         last_error = ?,
         run_after = ?,
         provider = NULL,
         model = NULL,
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE id = ?`,
    [status, attempt, errorMessage, retryAt, timestamp, edition.id]
  );
};

const reclaimExpiredEditions = async (db: Db) => {
  const timestamp = now();
  await dbRun(
    db,
    `UPDATE news_brief_editions
     SET status = 'pending',
         locked_by = NULL,
         locked_at = NULL,
         lease_expires_at = NULL,
         updated_at = ?
     WHERE status = 'running'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at <= ?`,
    [timestamp, timestamp]
  );
};

async function processEdition(
  db: Db,
  edition: PersistedNewsBriefEdition,
  generationContext: NewsBriefGenerationContext
) {
  const candidates = await listNewsBriefCandidates(
    db,
    { scoreCutoff: edition.score_cutoff },
    edition.window_start,
    edition.window_end,
    edition.user_id
  );

  if (candidates.length === 0) {
    await completeEdition(db, edition.id, {
      status: 'empty',
      candidateCount: 0,
      bullets: [],
      provider: generationContext.provider,
      model: generationContext.model
    });
    return 'empty' as const;
  }

  if (!generationContext.apiKey) {
    throw new Error('No provider key');
  }

  const windowLabel = `${DateTime.fromMillis(edition.window_start, { zone: edition.timezone }).toFormat('MMM d, h:mm a')} to ${DateTime.fromMillis(edition.window_end, { zone: edition.timezone }).toFormat('MMM d, h:mm a')} (${edition.timezone})`;
  const generated = await generateNewsBriefLlm(
    generationContext.provider as 'openai' | 'anthropic',
    generationContext.apiKey,
    generationContext.model,
    {
      windowLabel,
      candidates: candidates.map((candidate) => ({
        id: candidate.articleId,
        title: candidate.title,
        sourceName: candidate.sourceName,
        publishedAt: candidate.publishedAt ?? candidate.fetchedAt,
        effectiveScore: candidate.effectiveScore,
        context: candidate.context
      })),
      maxBullets: NEWS_BRIEF_MAX_BULLETS,
      maxSourcesPerBullet: NEWS_BRIEF_MAX_SOURCES_PER_BULLET
    },
    { reasoningEffort: generationContext.reasoningEffort }
  );

  const candidateById = new Map(
    candidates.map((candidate) => [
      candidate.articleId,
      {
        title: candidate.title ?? 'Untitled article',
        canonicalUrl: candidate.canonicalUrl
      }
    ])
  );

  const bullets: NewsBriefBullet[] = generated.bullets
    .map((bullet) => ({
      text: bullet.text,
      sources: bullet.sourceArticleIds
        .map((articleId) => {
          const article = candidateById.get(articleId);
          if (!article) return null;
          return {
            articleId,
            title: article.title,
            canonicalUrl: article.canonicalUrl
          };
        })
        .filter(Boolean) as NewsBriefBullet['sources']
    }))
    .filter((bullet) => bullet.text.trim().length > 0 && bullet.sources.length > 0);

  if (bullets.length === 0) {
    throw new Error('No valid bullets returned');
  }

  await completeEdition(db, edition.id, {
    status: 'ready',
    candidateCount: candidates.length,
    bullets,
    provider: generationContext.provider,
    model: generationContext.model
  });

  return 'ready' as const;
}

export async function processNewsBriefEditionById(
  db: Db,
  env: App.Platform['env'],
  editionId: string,
  options: { skipClaim?: boolean } = {}
) {
  const edition = await loadEditionById(db, editionId);
  if (!edition) {
    throw new Error(`News Brief edition not found: ${editionId}`);
  }
  const generationContext = await resolveNewsBriefGenerationContext(db, env, edition.user_id);

  if (!options.skipClaim) {
    const claimed = await claimEdition(db, editionId, `news-brief:${nanoid()}`);
    if (!claimed) {
      const latest = await loadEditionById(db, editionId);
      return latest;
    }
  } else {
    await dbRun(
      db,
      `UPDATE news_brief_editions
       SET status = 'running',
           locked_by = ?,
           locked_at = ?,
           lease_expires_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [`manual:${nanoid()}`, now(), now() + NEWS_BRIEF_LEASE_MS, now(), editionId]
    );
  }

  const runningEdition = await loadEditionById(db, editionId);
  if (!runningEdition) {
    throw new Error(`News Brief edition not found after claim: ${editionId}`);
  }

  try {
    await processEdition(db, runningEdition, generationContext);
  } catch (error) {
    await failEdition(
      db,
      runningEdition,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }

  return loadEditionById(db, editionId);
}

export async function processPendingNewsBriefEditions(
  db: Db,
  env: App.Platform['env'],
  options: { limit?: number } = {}
): Promise<NewsBriefQueueSummary> {
  await reclaimExpiredEditions(db);
  const limit = Math.max(1, Math.min(4, Math.floor(Number(options.limit ?? 2))));
  const pending = await dbAll<{ id: string; user_id: string }>(
    db,
    `SELECT id, user_id
     FROM news_brief_editions
     WHERE status = 'pending'
       AND run_after <= ?
     ORDER BY COALESCE(scheduled_for, created_at) ASC
     LIMIT ?`,
    [now(), limit]
  );

  let processedCount = 0;
  let readyCount = 0;
  let emptyCount = 0;
  let failedCount = 0;
  let providerReady = true;

  // Cache generation contexts per-user to avoid redundant lookups
  const contextCache = new Map<string, NewsBriefGenerationContext>();

  for (const row of pending) {
    const claimed = await claimEdition(db, row.id, `news-brief:${nanoid()}`);
    if (!claimed) continue;

    const edition = await loadEditionById(db, row.id);
    if (!edition) continue;

    let generationContext = contextCache.get(edition.user_id);
    if (!generationContext) {
      generationContext = await resolveNewsBriefGenerationContext(db, env, edition.user_id);
      contextCache.set(edition.user_id, generationContext);
    }
    if (!generationContext.apiKey) providerReady = false;

    try {
      const result = await processEdition(db, edition, generationContext);
      processedCount += 1;
      if (result === 'ready') readyCount += 1;
      if (result === 'empty') emptyCount += 1;
    } catch (error) {
      processedCount += 1;
      failedCount += 1;
      await failEdition(db, edition, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    providerReady,
    queuedCount: pending.length,
    dueCount: pending.length,
    processedCount,
    readyCount,
    emptyCount,
    failedCount
  };
}

export async function getLatestNewsBriefEditionSummary(db: Db, userId?: string): Promise<NewsBriefEditionSummary | null> {
  const userFilter = userId ? 'WHERE user_id = ?' : '';
  const params = userId ? [userId] : [];
  const edition = await dbGet<PersistedNewsBriefEdition>(
    db,
    `SELECT
      id,
      user_id,
      edition_key,
      edition_kind,
      edition_slot,
      timezone,
      scheduled_for,
      window_start,
      window_end,
      score_cutoff,
      status,
      candidate_count,
      bullets_json,
      source_article_ids_json,
      provider,
      model,
      last_error,
      attempts,
      run_after,
      generated_at,
      created_at,
      updated_at
     FROM news_brief_editions
     ${userFilter}
     ORDER BY COALESCE(generated_at, scheduled_for, created_at) DESC
     LIMIT 1`,
    params
  );

  if (!edition) return null;
  return {
    id: edition.id,
    status: edition.status,
    editionLabel: getEditionLabel(edition.edition_slot),
    generatedAt: edition.generated_at,
    candidateCount: edition.candidate_count,
    updatedAt: edition.updated_at
  };
}

export async function getDashboardNewsBrief(
  db: Db,
  env: App.Platform['env'],
  referenceAt = Date.now(),
  userId?: string
): Promise<DashboardNewsBriefState | null> {
  const generationContext = await resolveNewsBriefGenerationContext(db, env, userId);
  const nextScheduledAt = generationContext.config.enabled
    ? getNextScheduledNewsBriefAt(generationContext.config, referenceAt)
    : null;

  if (!generationContext.config.enabled) {
    return null;
  }

  const userFilter = userId ? 'AND user_id = ?' : '';
  const userParams = userId ? [userId] : [];

  const latestCompleted = await dbGet<PersistedNewsBriefEdition>(
    db,
    `SELECT
      id,
      user_id,
      edition_key,
      edition_kind,
      edition_slot,
      timezone,
      scheduled_for,
      window_start,
      window_end,
      score_cutoff,
      status,
      candidate_count,
      bullets_json,
      source_article_ids_json,
      provider,
      model,
      last_error,
      attempts,
      run_after,
      generated_at,
      created_at,
      updated_at
     FROM news_brief_editions
     WHERE status IN ('ready', 'empty')
       ${userFilter}
     ORDER BY COALESCE(generated_at, scheduled_for, created_at) DESC
     LIMIT 1`,
    userParams
  );

  const latestDueSlot = getLatestDueNewsBriefSlot(generationContext.config, referenceAt);

  if (latestCompleted) {
    return {
      state: latestCompleted.status === 'ready' ? 'ready' : 'empty',
      title: NEWS_BRIEF_TITLE,
      editionLabel: getEditionLabel(latestCompleted.edition_slot),
      generatedAt: latestCompleted.generated_at,
      windowHours: Math.max(
        1,
        Math.round((latestCompleted.window_end - latestCompleted.window_start) / (1000 * 60 * 60))
      ),
      scoreCutoff: latestCompleted.score_cutoff,
      bullets: parseBullets(latestCompleted.bullets_json),
      nextScheduledAt,
      stale:
        latestDueSlot !== null &&
        getEditionTimestamp(latestCompleted) < latestDueSlot.scheduledFor
    };
  }

  const latestPending = await dbGet<PersistedNewsBriefEdition>(
    db,
    `SELECT
      id,
      user_id,
      edition_key,
      edition_kind,
      edition_slot,
      timezone,
      scheduled_for,
      window_start,
      window_end,
      score_cutoff,
      status,
      candidate_count,
      bullets_json,
      source_article_ids_json,
      provider,
      model,
      last_error,
      attempts,
      run_after,
      generated_at,
      created_at,
      updated_at
     FROM news_brief_editions
     WHERE status IN ('pending', 'running')
       ${userFilter}
     ORDER BY COALESCE(scheduled_for, created_at) DESC
     LIMIT 1`,
    userParams
  );

  if (latestPending) {
    return {
      state: 'pending',
      title: NEWS_BRIEF_TITLE,
      editionLabel: getEditionLabel(latestPending.edition_slot),
      generatedAt: null,
      windowHours: Math.max(
        1,
        Math.round((latestPending.window_end - latestPending.window_start) / (1000 * 60 * 60))
      ),
      scoreCutoff: latestPending.score_cutoff,
      bullets: [],
      nextScheduledAt,
      stale: false
    };
  }

  return {
    state: 'unavailable',
    title: NEWS_BRIEF_TITLE,
    editionLabel: 'Awaiting first edition',
    generatedAt: null,
    windowHours: generationContext.config.lookbackHours,
    scoreCutoff: generationContext.config.scoreCutoff,
    bullets: [],
    nextScheduledAt,
    stale: false
  };
}

export async function runNewsBriefSchedulerTick(
  db: Db,
  env: App.Platform['env'],
  referenceAt = now()
): Promise<NewsBriefQueueSummary> {
  const queued = await queueDueNewsBriefEditions(db, env, referenceAt);
  const processed = await processPendingNewsBriefEditions(db, env);

  const summary: NewsBriefQueueSummary = {
    providerReady: queued.providerReady && processed.providerReady,
    queuedCount: queued.queuedCount,
    dueCount: queued.dueCount,
    processedCount: processed.processedCount,
    readyCount: processed.readyCount,
    emptyCount: processed.emptyCount,
    failedCount: processed.failedCount
  };

  logInfo('news_brief.scheduler_tick.completed', summary);
  return summary;
}
