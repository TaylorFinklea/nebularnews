import { json } from '@sveltejs/kit';
import { dbBatch, dbGet, dbRun } from '$lib/server/db';

const deletableArticlesCountSql = `SELECT COUNT(*) AS count
FROM articles a
WHERE EXISTS (
  SELECT 1
  FROM article_sources src
  WHERE src.article_id = a.id
    AND src.feed_id = ?
)
AND NOT EXISTS (
  SELECT 1
  FROM article_sources other
  WHERE other.article_id = a.id
    AND other.feed_id <> ?
)`;

const deletableArticlesSelectionSql = `SELECT a.id
FROM articles a
WHERE EXISTS (
  SELECT 1
  FROM article_sources src
  WHERE src.article_id = a.id
    AND src.feed_id = ?
)
AND NOT EXISTS (
  SELECT 1
  FROM article_sources other
  WHERE other.article_id = a.id
    AND other.feed_id <> ?
)`;

const loadDeletePreview = async (db: D1Database, feedId: string) => {
  const feed = await dbGet<{ id: string; title: string | null; url: string }>(
    db,
    'SELECT id, title, url FROM feeds WHERE id = ?',
    [feedId]
  );
  if (!feed) return null;

  const row = await dbGet<{ count: number }>(db, deletableArticlesCountSql, [feedId, feedId]);
  return {
    feed,
    deletePreview: {
      feedCount: 1,
      articleCount: Number(row?.count ?? 0)
    }
  };
};

export const GET = async ({ params, platform }) => {
  const { id } = params;
  const preview = await loadDeletePreview(platform.env.DB, id);
  if (!preview) return json({ error: 'Feed not found' }, { status: 404 });
  return json(preview);
};

export const DELETE = async ({ params, platform }) => {
  const { id } = params;
  const preview = await loadDeletePreview(platform.env.DB, id);
  if (!preview) return json({ error: 'Feed not found' }, { status: 404 });

  await dbBatch(platform.env.DB, [
    {
      sql: `DELETE FROM article_search
            WHERE article_id IN (${deletableArticlesSelectionSql})`,
      params: [id, id]
    },
    {
      sql: `DELETE FROM chat_threads
            WHERE scope = 'article'
              AND article_id IN (${deletableArticlesSelectionSql})`,
      params: [id, id]
    },
    {
      sql: `DELETE FROM jobs
            WHERE article_id IN (${deletableArticlesSelectionSql})`,
      params: [id, id]
    },
    {
      sql: `DELETE FROM articles
            WHERE id IN (${deletableArticlesSelectionSql})`,
      params: [id, id]
    },
    {
      sql: 'DELETE FROM feeds WHERE id = ?',
      params: [id]
    }
  ]);

  await dbRun(
    platform.env.DB,
    `DELETE FROM article_search
     WHERE article_id NOT IN (SELECT id FROM articles)`
  );

  return json({
    ok: true,
    deleted: {
      feeds: 1,
      articles: preview.deletePreview.articleCount
    }
  });
};
