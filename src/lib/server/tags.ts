import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from './db';

export type TagSource = 'manual' | 'ai' | 'system';

export type Tag = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  description: string | null;
  created_at: number;
  updated_at: number;
};

export type TagWithCount = Tag & { article_count: number };
export type TagMergeResult = { moved: number; sourceTagId: string; targetTagId: string; deletedSource: boolean };

export type ArticleTag = Tag & {
  source: TagSource;
  confidence: number | null;
  attached_at: number;
  attached_updated_at: number;
};

export type ArticleTagSuggestion = {
  id: string;
  article_id: string;
  name: string;
  name_normalized: string;
  confidence: number | null;
  source_provider: string | null;
  source_model: string | null;
  created_at: number;
  updated_at: number;
};

export type ExistingTagCandidate = {
  id: string;
  name: string;
  article_count: number;
  match_score: number;
};

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');
const normalizeTagKey = (value: string) => normalizeWhitespace(value).toLowerCase();

export const normalizeTagName = (value: string) => normalizeWhitespace(value).slice(0, 64);
export const normalizeTagSuggestionName = normalizeTagName;
export const normalizeTagSuggestionKey = normalizeTagKey;

export const slugifyTagName = (value: string) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'tag';

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
const MATCH_CANDIDATE_SCAN_LIMIT = 400;
const DEFAULT_MATCH_CANDIDATE_LIMIT = 50;
const MAX_MATCH_CANDIDATE_LIMIT = 100;
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'your',
  'about',
  'their',
  'will',
  'have',
  'has',
  'are',
  'was',
  'were',
  'not',
  'you',
  'its',
  'new',
  'how',
  'why',
  'who',
  'what',
  'when',
  'where',
  'can',
  'could',
  'should',
  'would',
  'over',
  'under',
  'more',
  'less'
]);

const tokenizeForMatch = (value: string) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const nextAvailableSlug = async (db: Db, baseSlug: string, excludeTagId?: string) => {
  let candidate = baseSlug;
  let suffix = 2;
  while (true) {
    const existing = await dbGet<{ id: string }>(
      db,
      `SELECT id
       FROM tags
       WHERE slug = ?
         ${excludeTagId ? 'AND id != ?' : ''}
       LIMIT 1`,
      excludeTagId ? [candidate, excludeTagId] : [candidate]
    );
    if (!existing) return candidate;
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
};

export async function getTagById(db: Db, id: string) {
  return dbGet<Tag>(db, 'SELECT id, name, slug, color, description, created_at, updated_at FROM tags WHERE id = ? LIMIT 1', [
    id
  ]);
}

export async function createTag(
  db: Db,
  input: { name: string; color?: string | null; description?: string | null }
): Promise<Tag> {
  const name = normalizeTagName(input.name);
  if (!name) throw new Error('Tag name is required');
  const nameNormalized = normalizeTagKey(name);

  const existing = await dbGet<Tag>(db, 'SELECT id, name, slug, color, description, created_at, updated_at FROM tags WHERE name_normalized = ? LIMIT 1', [
    nameNormalized
  ]);
  if (existing) return existing;

  const createdAt = now();
  const slug = await nextAvailableSlug(db, slugifyTagName(name));
  const id = nanoid();
  await dbRun(
    db,
    `INSERT INTO tags (id, name, name_normalized, slug, color, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, nameNormalized, slug, input.color ?? null, input.description ?? null, createdAt, createdAt]
  );

  const inserted = await getTagById(db, id);
  if (!inserted) throw new Error('Failed to create tag');
  return inserted;
}

export async function updateTag(
  db: Db,
  tagId: string,
  input: { name?: string; color?: string | null; description?: string | null }
) {
  const existing = await getTagById(db, tagId);
  if (!existing) return null;

  const nextName = input.name ? normalizeTagName(input.name) : existing.name;
  if (!nextName) throw new Error('Tag name is required');
  const nextNameNormalized = normalizeTagKey(nextName);
  const nameChanged = nextNameNormalized !== normalizeTagKey(existing.name);
  const nextSlug = nameChanged
    ? await nextAvailableSlug(db, slugifyTagName(nextName), tagId)
    : existing.slug;
  const updatedAt = now();

  await dbRun(
    db,
    `UPDATE tags
     SET name = ?, name_normalized = ?, slug = ?, color = ?, description = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextName,
      nextNameNormalized,
      nextSlug,
      input.color === undefined ? existing.color : input.color,
      input.description === undefined ? existing.description : input.description,
      updatedAt,
      tagId
    ]
  );

  return getTagById(db, tagId);
}

export async function deleteTag(db: Db, tagId: string) {
  await dbRun(db, 'DELETE FROM tags WHERE id = ?', [tagId]);
}

export async function getTagUsageCount(db: Db, tagId: string) {
  const row = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM article_tags WHERE tag_id = ?', [tagId]);
  return Number(row?.count ?? 0);
}

export async function listTags(db: Db, options?: { q?: string; limit?: number }): Promise<TagWithCount[]> {
  const q = options?.q?.trim() ?? '';
  const limit = Math.min(200, Math.max(1, Number(options?.limit ?? 100)));
  const params: unknown[] = [];
  const where =
    q.length > 0
      ? (() => {
          params.push(`%${q}%`, `%${q.toLowerCase()}%`, `%${q}%`);
          return 'WHERE t.name LIKE ? OR t.slug LIKE ? OR COALESCE(t.description, \'\') LIKE ?';
        })()
      : '';

  const rows = await dbAll<TagWithCount>(
    db,
    `SELECT
      t.id,
      t.name,
      t.slug,
      t.color,
      t.description,
      t.created_at,
      t.updated_at,
      COUNT(at.article_id) as article_count
    FROM tags t
    LEFT JOIN article_tags at ON at.tag_id = t.id
    ${where}
    GROUP BY t.id
    ORDER BY t.name COLLATE NOCASE ASC
    LIMIT ?`,
    [...params, limit]
  );
  return rows.map((row) => ({ ...row, article_count: Number(row.article_count ?? 0) }));
}

export async function listTagsForArticles(db: Db, articleIds: string[]) {
  const deduped = [...new Set(articleIds.filter(Boolean))];
  const byArticle = new Map<string, ArticleTag[]>();
  if (deduped.length === 0) return byArticle;

  const rows = await dbAll<{
    article_id: string;
    id: string;
    name: string;
    slug: string;
    color: string | null;
    description: string | null;
    created_at: number;
    updated_at: number;
    source: TagSource;
    confidence: number | null;
    attached_at: number;
    attached_updated_at: number;
  }>(
    db,
    `SELECT
      at.article_id,
      t.id,
      t.name,
      t.slug,
      t.color,
      t.description,
      t.created_at,
      t.updated_at,
      at.source,
      at.confidence,
      at.created_at as attached_at,
      at.updated_at as attached_updated_at
    FROM article_tags at
    JOIN tags t ON t.id = at.tag_id
    WHERE at.article_id IN (${placeholders(deduped.length)})
    ORDER BY t.name COLLATE NOCASE ASC`,
    deduped
  );

  for (const row of rows) {
    const item: ArticleTag = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      color: row.color,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: row.source,
      confidence: row.confidence,
      attached_at: row.attached_at,
      attached_updated_at: row.attached_updated_at
    };
    const list = byArticle.get(row.article_id) ?? [];
    list.push(item);
    byArticle.set(row.article_id, list);
  }

  return byArticle;
}

export async function listTagsForArticle(db: Db, articleId: string) {
  const byArticle = await listTagsForArticles(db, [articleId]);
  return byArticle.get(articleId) ?? [];
}

export async function listTagSuggestionsForArticles(db: Db, articleIds: string[]) {
  const deduped = [...new Set(articleIds.filter(Boolean))];
  const byArticle = new Map<string, ArticleTagSuggestion[]>();
  if (deduped.length === 0) return byArticle;

  const rows = await dbAll<ArticleTagSuggestion>(
    db,
    `SELECT
      id,
      article_id,
      name,
      name_normalized,
      confidence,
      source_provider,
      source_model,
      created_at,
      updated_at
    FROM article_tag_suggestions
    WHERE article_id IN (${placeholders(deduped.length)})
    ORDER BY article_id ASC, confidence DESC NULLS LAST, name COLLATE NOCASE ASC`,
    deduped
  );

  for (const row of rows) {
    const list = byArticle.get(row.article_id) ?? [];
    list.push({
      ...row,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence)
    });
    byArticle.set(row.article_id, list);
  }

  return byArticle;
}

export async function listTagSuggestionsForArticle(db: Db, articleId: string) {
  const byArticle = await listTagSuggestionsForArticles(db, [articleId]);
  return byArticle.get(articleId) ?? [];
}

export async function listDismissedSuggestionNamesForArticle(db: Db, articleId: string) {
  const rows = await dbAll<{ name_normalized: string }>(
    db,
    'SELECT name_normalized FROM article_tag_suggestion_dismissals WHERE article_id = ?',
    [articleId]
  );
  return new Set(rows.map((row) => row.name_normalized));
}

export async function upsertTagSuggestion(
  db: Db,
  input: {
    articleId: string;
    name: string;
    confidence?: number | null;
    sourceProvider?: string | null;
    sourceModel?: string | null;
  }
) {
  const name = normalizeTagSuggestionName(input.name);
  const nameNormalized = normalizeTagSuggestionKey(name);
  if (!name || !nameNormalized) return;
  const nowTs = now();
  const confidence =
    input.confidence === null || input.confidence === undefined
      ? null
      : Math.max(0, Math.min(1, Number(input.confidence)));
  await dbRun(
    db,
    `INSERT INTO article_tag_suggestions (
       id,
       article_id,
       name,
       name_normalized,
       confidence,
       source_provider,
       source_model,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(article_id, name_normalized) DO UPDATE SET
       name = excluded.name,
       confidence = excluded.confidence,
       source_provider = excluded.source_provider,
       source_model = excluded.source_model,
       updated_at = excluded.updated_at`,
    [
      nanoid(),
      input.articleId,
      name,
      nameNormalized,
      confidence,
      input.sourceProvider ?? null,
      input.sourceModel ?? null,
      nowTs,
      nowTs
    ]
  );
}

export async function replaceTagSuggestionsForArticle(
  db: Db,
  input: {
    articleId: string;
    sourceProvider?: string | null;
    sourceModel?: string | null;
    suggestions: Array<{ name: string; confidence?: number | null }>;
  }
) {
  const normalized = new Map<string, { name: string; confidence: number | null }>();
  for (const candidate of input.suggestions) {
    const name = normalizeTagSuggestionName(candidate.name);
    if (!name) continue;
    const key = normalizeTagSuggestionKey(name);
    if (!key) continue;
    const confidence =
      candidate.confidence === null || candidate.confidence === undefined
        ? null
        : Math.max(0, Math.min(1, Number(candidate.confidence)));
    const existing = normalized.get(key);
    if (!existing) {
      normalized.set(key, { name, confidence });
      continue;
    }
    if ((confidence ?? -1) > (existing.confidence ?? -1)) {
      normalized.set(key, { name, confidence });
    }
  }

  for (const candidate of normalized.values()) {
    await upsertTagSuggestion(db, {
      articleId: input.articleId,
      name: candidate.name,
      confidence: candidate.confidence,
      sourceProvider: input.sourceProvider ?? null,
      sourceModel: input.sourceModel ?? null
    });
  }

  const keys = [...normalized.keys()];
  if (keys.length > 0) {
    await dbRun(
      db,
      `DELETE FROM article_tag_suggestions
       WHERE article_id = ?
         AND name_normalized NOT IN (${placeholders(keys.length)})`,
      [input.articleId, ...keys]
    );
  } else {
    await dbRun(db, 'DELETE FROM article_tag_suggestions WHERE article_id = ?', [input.articleId]);
  }
}

export async function dismissTagSuggestion(db: Db, articleId: string, name: string) {
  const normalized = normalizeTagSuggestionKey(name);
  if (!normalized) return;
  const createdAt = now();
  await dbRun(
    db,
    `INSERT INTO article_tag_suggestion_dismissals (article_id, name_normalized, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(article_id, name_normalized) DO UPDATE SET
       created_at = excluded.created_at`,
    [articleId, normalized, createdAt]
  );
  await dbRun(
    db,
    'DELETE FROM article_tag_suggestions WHERE article_id = ? AND name_normalized = ?',
    [articleId, normalized]
  );
}

export async function undoDismissTagSuggestion(
  db: Db,
  input: {
    articleId: string;
    name: string;
    confidence?: number | null;
    sourceProvider?: string | null;
    sourceModel?: string | null;
  }
) {
  const normalized = normalizeTagSuggestionKey(input.name);
  if (!normalized) return;
  await dbRun(
    db,
    'DELETE FROM article_tag_suggestion_dismissals WHERE article_id = ? AND name_normalized = ?',
    [input.articleId, normalized]
  );
  await upsertTagSuggestion(db, {
    articleId: input.articleId,
    name: input.name,
    confidence: input.confidence ?? null,
    sourceProvider: input.sourceProvider ?? null,
    sourceModel: input.sourceModel ?? null
  });
}

export async function clearAllDismissedTagSuggestions(db: Db) {
  await dbRun(db, 'DELETE FROM article_tag_suggestion_dismissals');
}

export async function listExistingTagCandidatesForArticle(
  db: Db,
  input: { title?: string | null; contentText?: string | null; limit?: number }
): Promise<ExistingTagCandidate[]> {
  const limit = Math.min(
    MAX_MATCH_CANDIDATE_LIMIT,
    Math.max(1, Math.round(Number(input.limit ?? DEFAULT_MATCH_CANDIDATE_LIMIT)))
  );
  const body = `${input.title ?? ''}\n${String(input.contentText ?? '').slice(0, 9000)}`;
  const articleTokens = new Set(tokenizeForMatch(body));
  const bodyLower = body.toLowerCase();

  const rows = await dbAll<{ id: string; name: string; article_count: number }>(
    db,
    `SELECT t.id, t.name, COUNT(at.article_id) AS article_count
     FROM tags t
     JOIN article_tags at ON at.tag_id = t.id
     GROUP BY t.id
     HAVING COUNT(at.article_id) > 0
     ORDER BY article_count DESC, t.updated_at DESC
     LIMIT ?`,
    [MATCH_CANDIDATE_SCAN_LIMIT]
  );

  const ranked = rows
    .map((row) => {
      const candidateTokens = tokenizeForMatch(row.name);
      const overlap = candidateTokens.reduce((count, token) => count + (articleTokens.has(token) ? 1 : 0), 0);
      const phrase = row.name.toLowerCase();
      const phraseHit = phrase.length >= 3 && bodyLower.includes(phrase) ? 1 : 0;
      const matchScore = overlap * 8 + phraseHit * 5 + Math.log1p(Number(row.article_count ?? 0));
      return {
        id: row.id,
        name: row.name,
        article_count: Number(row.article_count ?? 0),
        match_score: Number(matchScore.toFixed(4)),
        overlap,
        phraseHit
      };
    })
    .filter((row) => row.overlap > 0 || row.phraseHit > 0)
    .sort((a, b) => b.match_score - a.match_score || b.article_count - a.article_count || a.name.localeCompare(b.name));

  const selected = ranked.slice(0, limit);
  if (selected.length < limit) {
    const used = new Set(selected.map((row) => row.id));
    for (const row of rows) {
      if (selected.length >= limit) break;
      if (used.has(row.id)) continue;
      selected.push({
        id: row.id,
        name: row.name,
        article_count: Number(row.article_count ?? 0),
        match_score: Number(Math.log1p(Number(row.article_count ?? 0)).toFixed(4)),
        overlap: 0,
        phraseHit: 0
      });
      used.add(row.id);
    }
  }

  return selected.map(({ overlap: _overlap, phraseHit: _phraseHit, ...entry }) => entry);
}

export async function resolveTagsByTokens(db: Db, tokens: string[]) {
  const cleaned = [...new Set(tokens.map((token) => token.trim()).filter(Boolean))];
  if (cleaned.length === 0) return [] as Tag[];

  const slugTokens = cleaned.map((token) => token.toLowerCase());
  const normalizedNameTokens = cleaned.map((token) => normalizeTagKey(token)).filter(Boolean);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (cleaned.length > 0) {
    conditions.push(`id IN (${placeholders(cleaned.length)})`);
    params.push(...cleaned);
  }
  if (slugTokens.length > 0) {
    conditions.push(`slug IN (${placeholders(slugTokens.length)})`);
    params.push(...slugTokens);
  }
  if (normalizedNameTokens.length > 0) {
    conditions.push(`name_normalized IN (${placeholders(normalizedNameTokens.length)})`);
    params.push(...normalizedNameTokens);
  }

  if (conditions.length === 0) return [] as Tag[];

  return dbAll<Tag>(
    db,
    `SELECT id, name, slug, color, description, created_at, updated_at
     FROM tags
     WHERE ${conditions.join(' OR ')}`,
    params
  );
}

export async function attachTagToArticle(
  db: Db,
  input: { articleId: string; tagId: string; source?: TagSource; confidence?: number | null }
) {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO article_tags (id, article_id, tag_id, source, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(article_id, tag_id) DO UPDATE SET
       source = excluded.source,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at`,
    [
      nanoid(),
      input.articleId,
      input.tagId,
      input.source ?? 'manual',
      input.confidence ?? null,
      timestamp,
      timestamp
    ]
  );
}

export async function detachTagFromArticle(db: Db, articleId: string, tagId: string) {
  await dbRun(db, 'DELETE FROM article_tags WHERE article_id = ? AND tag_id = ?', [articleId, tagId]);
}

export async function ensureTagByName(
  db: Db,
  name: string,
  input?: { color?: string | null; description?: string | null }
) {
  return createTag(db, { name, color: input?.color, description: input?.description });
}

export async function mergeTags(
  db: Db,
  input: { sourceTagId: string; targetTagId: string; deleteSource?: boolean }
): Promise<TagMergeResult> {
  const { sourceTagId, targetTagId, deleteSource = true } = input;
  if (sourceTagId === targetTagId) {
    throw new Error('Source and target tags must be different');
  }

  const source = await getTagById(db, sourceTagId);
  const target = await getTagById(db, targetTagId);
  if (!source || !target) throw new Error('Source or target tag not found');

  const movedBefore = await getTagUsageCount(db, sourceTagId);
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO article_tags (id, article_id, tag_id, source, confidence, created_at, updated_at)
     SELECT lower(hex(randomblob(16))), article_id, ?, source, confidence, created_at, ?
     FROM article_tags
     WHERE tag_id = ?
     ON CONFLICT(article_id, tag_id) DO UPDATE SET
       confidence = COALESCE(excluded.confidence, article_tags.confidence),
       source = CASE
         WHEN article_tags.source = 'manual' THEN article_tags.source
         ELSE excluded.source
       END,
       updated_at = excluded.updated_at`,
    [targetTagId, timestamp, sourceTagId]
  );
  await dbRun(db, 'DELETE FROM article_tags WHERE tag_id = ?', [sourceTagId]);
  if (deleteSource) {
    await deleteTag(db, sourceTagId);
  }

  return {
    moved: movedBefore,
    sourceTagId,
    targetTagId,
    deletedSource: deleteSource
  };
}

export async function reassignTagUsage(
  db: Db,
  input: { fromTagId: string; toTagId: string; keepFrom?: boolean }
) {
  const result = await mergeTags(db, {
    sourceTagId: input.fromTagId,
    targetTagId: input.toTagId,
    deleteSource: !input.keepFrom
  });
  return {
    moved: result.moved,
    fromTagId: input.fromTagId,
    toTagId: input.toTagId,
    keptFrom: input.keepFrom === true
  };
}
