import { json } from '@sveltejs/kit';
import { dbBatch, dbGet, dbRun } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

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

export const DELETE = async ({ request, params, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');

  const { id } = params;
  const feed = await dbGet<{ id: string }>(
    platform.env.DB,
    'SELECT id FROM feeds WHERE id = ?',
    [id]
  );
  if (!feed) return json({ error: 'Feed not found' }, { status: 404 });

  const row = await dbGet<{ count: number }>(
    platform.env.DB,
    `SELECT COUNT(*) AS count
     FROM articles a
     WHERE EXISTS (
       SELECT 1 FROM article_sources src
       WHERE src.article_id = a.id AND src.feed_id = ?
     )
     AND NOT EXISTS (
       SELECT 1 FROM article_sources other
       WHERE other.article_id = a.id AND other.feed_id <> ?
     )`,
    [id, id]
  );
  const articleCount = Number(row?.count ?? 0);

  await dbBatch(platform.env.DB, [
    {
      sql: `DELETE FROM article_search
            WHERE article_id IN (${deletableArticlesSelectionSql})`,
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
    deleted: { feeds: 1, articles: articleCount }
  });
};
