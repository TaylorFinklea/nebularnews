import { parse as parseCookie } from 'cookie';
import { dbAll, dbGet, type Db } from './db';
import { getPreferredSourcesForArticles } from './sources';
import { clampTimezoneOffsetMinutes, dayRangeForTimezoneOffset } from './time';

export type DashboardDayRange = {
  dayStart: number;
  dayEnd: number;
  tzOffsetMinutes: number;
};

export type DashboardStats = {
  feeds: number;
  articles: number;
  pendingJobs: number;
};

export type DashboardTodayStats = {
  articles: number;
  summaries: number;
  scores: number;
  pendingJobs: number;
  missingSummaries: number;
  missingScores: number;
  tzOffsetMinutes: number;
};

export type DashboardTopRatedArticle = {
  id: string;
  title: string | null;
  canonical_url: string | null;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number | null;
  excerpt: string | null;
  summary_text: string | null;
  score: number;
  label: string | null;
  source_name: string | null;
};

export const resolveDashboardDayRange = (cookieHeader: string | null, referenceAt = Date.now()): DashboardDayRange => {
  const cookies = parseCookie(cookieHeader ?? '');
  const tzOffsetMinutes = clampTimezoneOffsetMinutes(cookies.nebular_tz_offset_min, 0);
  const { dayStart, dayEnd } = dayRangeForTimezoneOffset(referenceAt, tzOffsetMinutes);
  return {
    dayStart,
    dayEnd,
    tzOffsetMinutes
  };
};

export const buildTopRatedScoreQuery = (scoreCutoff: number) => {
  return Array.from({ length: 5 }, (_, index) => 5 - index)
    .filter((score) => score >= scoreCutoff)
    .map((score) => `score=${score}`)
    .join('&');
};

export async function getDashboardStats(db: Db, range: DashboardDayRange): Promise<{
  stats: DashboardStats;
  today: DashboardTodayStats;
}> {
  const row = await dbGet<{
    feeds_count: number | null;
    articles_count: number | null;
    pending_jobs_count: number | null;
    today_articles_count: number | null;
    today_summaries_count: number | null;
    today_scores_count: number | null;
    today_pending_jobs_count: number | null;
    today_missing_summaries_count: number | null;
    today_missing_scores_count: number | null;
  }>(
    db,
    `WITH day_articles AS (
       SELECT id
       FROM articles
       WHERE COALESCE(published_at, fetched_at) >= ?
         AND COALESCE(published_at, fetched_at) < ?
     ),
     latest_scores AS (
       SELECT sc.article_id, sc.score
       FROM article_scores sc
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_scores
         GROUP BY article_id
       ) latest
         ON latest.article_id = sc.article_id
        AND latest.created_at = sc.created_at
     )
     SELECT
       (SELECT COUNT(*) FROM feeds) as feeds_count,
       (SELECT COUNT(*) FROM articles) as articles_count,
       (SELECT COUNT(*) FROM jobs WHERE status = 'pending') as pending_jobs_count,
       (SELECT COUNT(*) FROM day_articles) as today_articles_count,
       (
         SELECT COUNT(DISTINCT s.article_id)
         FROM article_summaries s
         JOIN day_articles d ON d.id = s.article_id
       ) as today_summaries_count,
       (
         SELECT COUNT(*)
         FROM day_articles d
         LEFT JOIN article_score_overrides o ON o.article_id = d.id
         LEFT JOIN latest_scores ls ON ls.article_id = d.id
         WHERE COALESCE(o.score, ls.score) IS NOT NULL
       ) as today_scores_count,
       (
         SELECT COUNT(*)
         FROM jobs j
         JOIN day_articles d ON d.id = j.article_id
         WHERE j.status = 'pending'
           AND j.type IN ('summarize', 'score')
       ) as today_pending_jobs_count,
       (
         SELECT COUNT(*)
         FROM day_articles d
         WHERE NOT EXISTS (
           SELECT 1 FROM article_summaries s WHERE s.article_id = d.id
         )
       ) as today_missing_summaries_count,
       (
         SELECT COUNT(*)
         FROM day_articles d
         LEFT JOIN article_score_overrides o ON o.article_id = d.id
         LEFT JOIN latest_scores ls ON ls.article_id = d.id
         WHERE COALESCE(o.score, ls.score) IS NULL
       ) as today_missing_scores_count`,
    [range.dayStart, range.dayEnd]
  );

  return {
    stats: {
      feeds: Number(row?.feeds_count ?? 0),
      articles: Number(row?.articles_count ?? 0),
      pendingJobs: Number(row?.pending_jobs_count ?? 0)
    },
    today: {
      articles: Number(row?.today_articles_count ?? 0),
      summaries: Number(row?.today_summaries_count ?? 0),
      scores: Number(row?.today_scores_count ?? 0),
      pendingJobs: Number(row?.today_pending_jobs_count ?? 0),
      missingSummaries: Number(row?.today_missing_summaries_count ?? 0),
      missingScores: Number(row?.today_missing_scores_count ?? 0),
      tzOffsetMinutes: range.tzOffsetMinutes
    }
  };
}

export async function getDashboardTopRatedArticles(
  db: Db,
  range: DashboardDayRange,
  options: {
    scoreCutoff: number;
    limit: number;
  }
): Promise<DashboardTopRatedArticle[]> {
  const rows = await dbAll<{
    id: string;
    title: string | null;
    canonical_url: string | null;
    image_url: string | null;
    published_at: number | null;
    fetched_at: number | null;
    excerpt: string | null;
    summary_text: string | null;
    score: number;
    label: string | null;
  }>(
    db,
    `WITH day_articles AS (
       SELECT id
       FROM articles
       WHERE COALESCE(published_at, fetched_at) >= ?
         AND COALESCE(published_at, fetched_at) < ?
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
     latest_scores AS (
       SELECT sc.article_id, sc.score, sc.label
       FROM article_scores sc
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_scores
         GROUP BY article_id
       ) latest
         ON latest.article_id = sc.article_id
        AND latest.created_at = sc.created_at
     )
     SELECT
       a.id,
       a.title,
       a.canonical_url,
       a.image_url,
       a.published_at,
       a.fetched_at,
       a.excerpt,
       ls.summary_text,
       COALESCE(o.score, lsc.score) as score,
       CASE
         WHEN o.article_id IS NOT NULL THEN 'User corrected'
         ELSE lsc.label
       END as label
     FROM day_articles d
     JOIN articles a ON a.id = d.id
     LEFT JOIN latest_summaries ls ON ls.article_id = a.id
     LEFT JOIN latest_scores lsc ON lsc.article_id = a.id
     LEFT JOIN article_score_overrides o ON o.article_id = a.id
     WHERE COALESCE(o.score, lsc.score) >= ?
     ORDER BY score DESC, COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT ?`,
    [range.dayStart, range.dayEnd, options.scoreCutoff, options.limit]
  );

  const sourceByArticle = await getPreferredSourcesForArticles(
    db,
    rows.map((row) => row.id)
  );

  return rows.map((row) => {
    const source = sourceByArticle.get(row.id);
    return {
      ...row,
      source_name: source?.sourceName ?? null
    };
  });
}
