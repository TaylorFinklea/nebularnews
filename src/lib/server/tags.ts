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

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');
const normalizeTagKey = (value: string) => normalizeWhitespace(value).toLowerCase();

export const normalizeTagName = (value: string) => normalizeWhitespace(value).slice(0, 64);

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
