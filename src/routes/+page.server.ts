import { dev } from '$app/environment';
import { dbGet } from '$lib/server/db';
import { getPreferredSourcesForArticles } from '$lib/server/sources';
import { parse as parseCookie } from 'cookie';
import { clampTimezoneOffsetMinutes, dayRangeForTimezoneOffset } from '$lib/server/time';

const effectiveScoreExpr = `COALESCE(
  (SELECT score FROM article_score_overrides WHERE article_id = a.id LIMIT 1),
  (SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1)
)`;

export const load = async ({ platform, request }) => {
  const db = platform.env.DB;
  const cookies = parseCookie(request.headers.get('cookie') ?? '');
  const tzOffsetMinutes = clampTimezoneOffsetMinutes(cookies.nebular_tz_offset_min, 0);
  const { dayStart, dayEnd } = dayRangeForTimezoneOffset(Date.now(), tzOffsetMinutes);

  const feeds = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM feeds');
  const articles = await dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM articles');
  const pendingJobs = await dbGet<{ count: number }>(
    db,
    "SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'"
  );
  const todayArticles = await dbGet<{ count: number }>(
    db,
    'SELECT COUNT(*) as count FROM articles WHERE COALESCE(published_at, fetched_at) >= ? AND COALESCE(published_at, fetched_at) < ?',
    [dayStart, dayEnd]
  );
  const todaySummaries = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND EXISTS (SELECT 1 FROM article_summaries s WHERE s.article_id = a.id)`,
    [dayStart, dayEnd]
  );
  const todayScores = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND ${effectiveScoreExpr} IS NOT NULL`,
    [dayStart, dayEnd]
  );
  const todayPendingJobs = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM jobs j
     JOIN articles a ON a.id = j.article_id
     WHERE j.status = 'pending'
       AND j.type IN ('summarize', 'score')
       AND COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?`,
    [dayStart, dayEnd]
  );
  const todayMissingSummaries = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND NOT EXISTS (SELECT 1 FROM article_summaries s WHERE s.article_id = a.id)`,
    [dayStart, dayEnd]
  );
  const todayMissingScores = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND ${effectiveScoreExpr} IS NULL`,
    [dayStart, dayEnd]
  );

  const topRated = await db.prepare(
    `SELECT
      a.id,
      a.title,
      a.canonical_url,
      a.published_at,
      a.fetched_at,
      a.excerpt,
      (SELECT summary_text FROM article_summaries sm WHERE sm.article_id = a.id ORDER BY created_at DESC LIMIT 1) as summary_text,
      ${effectiveScoreExpr} as score,
      CASE
        WHEN EXISTS (SELECT 1 FROM article_score_overrides WHERE article_id = a.id) THEN 'User corrected'
        ELSE (SELECT label FROM article_scores sc WHERE sc.article_id = a.id ORDER BY created_at DESC LIMIT 1)
      END as label
    FROM articles a
    WHERE COALESCE(a.published_at, a.fetched_at) >= ?
      AND COALESCE(a.published_at, a.fetched_at) < ?
      AND ${effectiveScoreExpr} >= 3
    ORDER BY score DESC, COALESCE(a.published_at, a.fetched_at) DESC
    LIMIT 5`
  )
    .bind(dayStart, dayEnd)
    .all<{
      id: string;
      title: string | null;
      canonical_url: string | null;
      published_at: number | null;
      fetched_at: number | null;
      excerpt: string | null;
      summary_text: string | null;
      score: number;
      label: string | null;
    }>();

  const topRatedRows = topRated.results ?? [];
  const sourceByArticle = await getPreferredSourcesForArticles(
    db,
    topRatedRows.map((article) => article.id)
  );
  const topRatedArticles = topRatedRows.map((article) => {
    const source = sourceByArticle.get(article.id);
    return {
      ...article,
      source_name: source?.sourceName ?? null
    };
  });

  return {
    isDev: dev,
    stats: {
      feeds: feeds?.count ?? 0,
      articles: articles?.count ?? 0,
      pendingJobs: pendingJobs?.count ?? 0
    },
    today: {
      articles: todayArticles?.count ?? 0,
      summaries: todaySummaries?.count ?? 0,
      scores: todayScores?.count ?? 0,
      pendingJobs: todayPendingJobs?.count ?? 0,
      missingSummaries: todayMissingSummaries?.count ?? 0,
      missingScores: todayMissingScores?.count ?? 0,
      tzOffsetMinutes
    },
    topRatedArticles
  };
};
