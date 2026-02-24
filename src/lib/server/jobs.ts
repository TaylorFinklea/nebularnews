import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from './db';
import { generateArticleKeyPoints, generateArticleTags, refreshPreferenceProfile, scoreArticle, summarizeArticle } from './llm';
import { extractLeadImageUrlFromHtml } from './images';
import {
  getFeatureProviderModel,
  getJobProcessorBatchSize,
  getProviderKey,
  getScorePromptConfig,
  getSummaryConfig
} from './settings';
import { ensurePreferenceProfile } from './profile';
import { attachTagToArticle, ensureTagByName } from './tags';
import { logInfo } from './log';
import { isJobBatchV2Enabled } from './flags';

const MAX_JOB_ATTEMPTS = 3;
const JOB_LEASE_MS = 1000 * 60 * 3;
const MAX_BACKOFF_MS = 1000 * 60 * 60;
const LEGACY_BATCH_SIZE = 5;
const PROCESS_TIME_BUDGET_MS = 20_000;
const PROD_PROCESS_TIME_BUDGET_MS = 8_000;
const MAX_BATCH_ROUNDS = 20;
const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_BACKFILL_RETRY_INTERVAL_MS = 1000 * 60 * 60 * 6;
const IMAGE_BACKFILL_PRESSURE_THRESHOLD = 20;
type JobRunMetadata = { provider: string; model: string } | null;

const getAffectedRows = (result: unknown) => {
  const cast = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(cast?.meta?.changes ?? cast?.changes ?? 0);
};

const computeRetryDelayMs = (attempts: number) => {
  const exponential = 1000 * 60 * 2 ** Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, exponential);
};

const createPendingTimestamp = () => now();

export async function processJobs(
  env: App.Platform['env'],
  options: {
    timeBudgetMs?: number;
  } = {}
) {
  const db = env.DB;
  const processorId = nanoid();
  const timestamp = now();
  const startedWallClock = Date.now();
  let claimed = 0;
  let done = 0;
  let failed = 0;
  let retried = 0;
  let selected = 0;
  let rounds = 0;
  const batchSize = isJobBatchV2Enabled(env) ? await getJobProcessorBatchSize(db, env) : LEGACY_BATCH_SIZE;
  const defaultBudgetMs = env.APP_ENV === 'production' ? PROD_PROCESS_TIME_BUDGET_MS : PROCESS_TIME_BUDGET_MS;
  const processTimeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(500, Math.min(30_000, Math.floor(Number(options.timeBudgetMs))))
    : defaultBudgetMs;

  // Reclaim stale running jobs whose lease has expired.
  await dbRun(
    db,
    `UPDATE jobs
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

  const processSingleJob = async (job: {
    id: string;
    type: string;
    article_id: string | null;
    attempts: number;
    priority: number;
    run_after: number;
  }) => {
    const lockTimestamp = now();
    const claimResult = await dbRun(
      db,
      `UPDATE jobs
       SET status = 'running',
           locked_by = ?,
           locked_at = ?,
           lease_expires_at = ?,
           updated_at = ?
       WHERE id = ?
         AND status = 'pending'
         AND run_after <= ?`,
      [processorId, lockTimestamp, lockTimestamp + JOB_LEASE_MS, lockTimestamp, job.id, lockTimestamp]
    );
    if (getAffectedRows(claimResult) === 0) return;
    claimed += 1;

    const attempt = job.attempts + 1;
    const jobRunId = nanoid();
    const startedAt = now();
    await dbRun(
      db,
      `INSERT INTO job_runs (id, job_id, attempt, status, started_at)
       VALUES (?, ?, ?, ?, ?)`,
      [jobRunId, job.id, attempt, 'running', startedAt]
    );

    try {
      let runMetadata: JobRunMetadata = null;
      if (job.type === 'summarize' && job.article_id) {
        runMetadata = await runSummarizeJob(db, env, job.article_id);
      } else if (job.type === 'summarize_chat' && job.article_id) {
        // Backward compatibility for older queued jobs; follows current Summaries lane setting.
        runMetadata = await runSummarizeJob(db, env, job.article_id);
      } else if (job.type === 'image_backfill' && job.article_id) {
        runMetadata = await runImageBackfillJob(db, job.article_id);
      } else if (job.type === 'key_points' && job.article_id) {
        runMetadata = await runKeyPointsJob(db, env, job.article_id);
      } else if (job.type === 'auto_tag' && job.article_id) {
        runMetadata = await runAutoTagJob(db, env, job.article_id);
      } else if (job.type === 'score' && job.article_id) {
        runMetadata = await runScoreJob(db, env, job.article_id);
      } else if (job.type === 'refresh_profile') {
        runMetadata = await runRefreshProfile(db, env);
      }

      const finishedAt = now();
      await dbRun(
        db,
        `UPDATE jobs
         SET status = ?,
             attempts = ?,
             last_error = NULL,
             provider = ?,
             model = ?,
             locked_by = NULL,
             locked_at = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`,
        ['done', attempt, runMetadata?.provider ?? null, runMetadata?.model ?? null, finishedAt, job.id]
      );
      await dbRun(
        db,
        `UPDATE job_runs
         SET status = ?,
             provider = ?,
             model = ?,
             duration_ms = ?,
             finished_at = ?
         WHERE id = ?`,
        ['done', runMetadata?.provider ?? null, runMetadata?.model ?? null, finishedAt - startedAt, finishedAt, jobRunId]
      );
      done += 1;
    } catch (err) {
      const status = attempt >= MAX_JOB_ATTEMPTS ? 'failed' : 'pending';
      const runAfter = status === 'failed' ? job.run_after : createPendingTimestamp() + computeRetryDelayMs(attempt);
      const errorMessage = String(err);
      const finishedAt = now();
      await dbRun(
        db,
        `UPDATE jobs
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
        [status, attempt, errorMessage, runAfter, finishedAt, job.id]
      );
      await dbRun(
        db,
        `UPDATE job_runs
         SET status = ?,
             error = ?,
             duration_ms = ?,
             finished_at = ?
         WHERE id = ?`,
        ['failed', errorMessage, finishedAt - startedAt, finishedAt, jobRunId]
      );
      if (status === 'failed') {
        failed += 1;
      } else {
        retried += 1;
      }
    }
  };

  while (Date.now() - startedWallClock < processTimeBudgetMs && rounds < MAX_BATCH_ROUNDS) {
    rounds += 1;
    const selectionTimestamp = now();
    const pressureRow = await dbGet<{ count: number }>(
      db,
      `SELECT COUNT(*) as count
       FROM jobs
       WHERE status = 'pending'
         AND type IN ('summarize', 'score', 'auto_tag', 'key_points', 'refresh_profile')`
    );
    const queuePressure = Number(pressureRow?.count ?? 0);
    const allowImageBackfill = queuePressure < IMAGE_BACKFILL_PRESSURE_THRESHOLD;
    const jobs = await dbAll<{
      id: string;
      type: string;
      article_id: string | null;
      attempts: number;
      priority: number;
      run_after: number;
    }>(
      db,
      `SELECT id, type, article_id, attempts, priority, run_after
       FROM jobs
       WHERE status = 'pending'
         AND run_after <= ?
         ${allowImageBackfill ? '' : "AND type != 'image_backfill'"}
       ORDER BY priority ASC, run_after ASC
       LIMIT ?`,
      [selectionTimestamp, batchSize]
    );
    if (jobs.length === 0) break;
    selected += jobs.length;

    for (const job of jobs) {
      await processSingleJob(job);
      if (Date.now() - startedWallClock >= processTimeBudgetMs) {
        break;
      }
    }

    if (jobs.length < batchSize) {
      break;
    }
  }

  const durationMs = Date.now() - startedWallClock;
  const pendingAfterRun = await dbGet<{ count: number }>(db, "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'");
  const pendingRemaining = Number(pendingAfterRun?.count ?? 0);
  const budgetExceeded = durationMs >= processTimeBudgetMs;
  logInfo('jobs.process.completed', {
    processor_id: processorId,
    selected,
    rounds,
    batch_size: batchSize,
    time_budget_ms: processTimeBudgetMs,
    budget_exceeded: budgetExceeded,
    claimed,
    done,
    failed,
    retried,
    image_backfill_allowed: pendingRemaining < IMAGE_BACKFILL_PRESSURE_THRESHOLD,
    pending_remaining: pendingRemaining,
    duration_ms: durationMs
  });

  return {
    processorId,
    selected,
    rounds,
    batchSize,
    processTimeBudgetMs,
    budgetExceeded,
    claimed,
    done,
    failed,
    retried,
    pendingRemaining,
    durationMs
  };
}

async function runImageBackfillJob(db: Db, articleId: string): Promise<JobRunMetadata> {
  const article = await dbGet<{
    canonical_url: string | null;
    image_url: string | null;
    image_checked_at: number | null;
    image_status: string | null;
  }>(
    db,
    'SELECT canonical_url, image_url, image_checked_at, image_status FROM articles WHERE id = ?',
    [articleId]
  );
  if (!article?.canonical_url) return null;
  if (article.image_url) {
    await dbRun(db, "UPDATE articles SET image_status = 'found', image_checked_at = ? WHERE id = ?", [now(), articleId]);
    return null;
  }

  const checkedAt = Number(article.image_checked_at ?? 0);
  if (
    Number.isFinite(checkedAt) &&
    checkedAt > 0 &&
    article.image_status === 'missing' &&
    checkedAt + IMAGE_BACKFILL_RETRY_INTERVAL_MS > now()
  ) {
    return null;
  }

  let imageUrl: string | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(article.canonical_url, {
      headers: { 'user-agent': 'NebularNews/0.1 (+image-backfill)' },
      signal: controller.signal
    });
    if (res.ok) {
      const html = await res.text();
      imageUrl = extractLeadImageUrlFromHtml(html, article.canonical_url);
    }
  } catch {
    // Best-effort job: ignore fetch failures and mark as missing for later retry.
  } finally {
    clearTimeout(timeout);
  }

  if (imageUrl) {
    await dbRun(
      db,
      "UPDATE articles SET image_url = ?, image_status = 'found', image_checked_at = ? WHERE id = ?",
      [imageUrl, now(), articleId]
    );
  } else {
    await dbRun(db, "UPDATE articles SET image_status = 'missing', image_checked_at = ? WHERE id = ?", [now(), articleId]);
  }

  return null;
}

async function runSummarizeJob(
  db: Db,
  env: App.Platform['env'],
  articleId: string
): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const { provider, model, reasoningEffort } = await getFeatureProviderModel(db, env, 'summaries');
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const summaryConfig = await getSummaryConfig(db);
  const contentText = article.content_text.slice(0, 12000);
  const summary = await summarizeArticle(
    provider,
    apiKey,
    model,
    {
      title: article.title,
      url: article.canonical_url,
      contentText,
      style: summaryConfig.style,
      length: summaryConfig.length
    },
    { reasoningEffort }
  );

  await dbRun(
    db,
    'INSERT INTO article_summaries (id, article_id, provider, model, summary_text, key_points_json, created_at, token_usage_json, prompt_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      nanoid(),
      articleId,
      provider,
      model,
      summary.summary,
      null,
      now(),
      JSON.stringify(summary.usage ?? {}),
      'v3-feature-lane'
    ]
  );

  await dbRun(db, 'UPDATE article_search SET summary_text = ? WHERE article_id = ?', [summary.summary, articleId]);
  return { provider, model };
}

async function runKeyPointsJob(db: Db, env: App.Platform['env'], articleId: string): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const { provider, model, reasoningEffort } = await getFeatureProviderModel(db, env, 'key_points');
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const summaryConfig = await getSummaryConfig(db);
  const contentText = article.content_text.slice(0, 12000);
  const keyPointResult = await generateArticleKeyPoints(
    provider,
    apiKey,
    model,
    {
      title: article.title,
      url: article.canonical_url,
      contentText,
      length: summaryConfig.length
    },
    { reasoningEffort }
  );

  await dbRun(
    db,
    'INSERT INTO article_key_points (id, article_id, provider, model, key_points_json, created_at, token_usage_json, prompt_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      nanoid(),
      articleId,
      provider,
      model,
      JSON.stringify(keyPointResult.keyPoints),
      now(),
      JSON.stringify(keyPointResult.usage ?? {}),
      'v1-pipeline'
    ]
  );

  return { provider, model };
}

async function runAutoTagJob(db: Db, env: App.Platform['env'], articleId: string): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const { provider, model, reasoningEffort } = await getFeatureProviderModel(db, env, 'auto_tagging');
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const generated = await generateArticleTags(
    provider,
    apiKey,
    model,
    {
      title: article.title,
      url: article.canonical_url,
      contentText: article.content_text.slice(0, 12000),
      maxTags: 6
    },
    { reasoningEffort }
  );
  if (generated.tags.length === 0) {
    throw new Error('No tags generated');
  }

  // Replace previous AI-generated tags only. Manual/system tags are retained.
  await dbRun(db, 'DELETE FROM article_tags WHERE article_id = ? AND source = ?', [articleId, 'ai']);

  for (const candidate of generated.tags) {
    const tag = await ensureTagByName(db, candidate.name);
    await attachTagToArticle(db, {
      articleId,
      tagId: tag.id,
      source: 'ai',
      confidence: candidate.confidence
    });
  }

  return { provider, model };
}


async function runScoreJob(db: Db, env: App.Platform['env'], articleId: string): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const profile = await ensurePreferenceProfile(db);
  const { provider, model, reasoningEffort } = await getFeatureProviderModel(db, env, 'scoring');
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const contentText = article.content_text.slice(0, 12000);
  const scorePromptConfig = await getScorePromptConfig(db);
  const scored = await scoreArticle(provider, apiKey, model, {
    title: article.title,
    url: article.canonical_url,
    contentText,
    profile: profile.profile_text
  }, { reasoningEffort }, scorePromptConfig);

  await dbRun(
    db,
    'INSERT INTO article_scores (id, article_id, score, label, reason_text, evidence_json, created_at, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      nanoid(),
      articleId,
      scored.score,
      scored.label,
      scored.reason,
      JSON.stringify(scored.evidence),
      now(),
      profile.version
    ]
  );
  return { provider, model };
}

async function runRefreshProfile(db: Db, env: App.Platform['env']): Promise<{ provider: string; model: string } | null> {
  const profile = await ensurePreferenceProfile(db);
  const feedback = await dbAll<{ rating: number; comment: string | null; title: string | null }>(
    db,
    `SELECT article_feedback.rating as rating, article_feedback.comment as comment, articles.title as title
     FROM article_feedback
     LEFT JOIN articles ON article_feedback.article_id = articles.id
     ORDER BY article_feedback.created_at DESC
     LIMIT 30`
  );

  if (feedback.length === 0) return null;

  const { provider, model, reasoningEffort } = await getFeatureProviderModel(db, env, 'profile_refresh');
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const updated = await refreshPreferenceProfile(provider, apiKey, model, {
    current: profile.profile_text,
    feedback
  }, { reasoningEffort });

  await dbRun(
    db,
    'UPDATE preference_profile SET profile_text = ?, updated_at = ?, version = version + 1 WHERE id = ?',
    [updated, now(), profile.id]
  );
  return { provider, model };
}
