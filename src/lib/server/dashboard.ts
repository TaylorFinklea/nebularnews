import { dbAll, dbGet, type Db } from './db';
import { getCookieValue } from './cookies';
import { getPreferredSourcesForArticles } from './sources';
import { clampTimezoneOffsetMinutes, dayRangeForTimezoneOffset } from './time';

const DAY_MS = 1000 * 60 * 60 * 24;

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

export type DashboardUnreadQueueArticle = {
  id: string;
  title: string | null;
  canonical_url: string | null;
  image_url: string | null;
  published_at: number | null;
  fetched_at: number | null;
  excerpt: string | null;
  summary_text: string | null;
  score: number | null;
  label: string | null;
  queue_reason: 'high_fit' | 'recent_unread';
  source_name: string | null;
};

export type DashboardReadingMomentum = {
  unreadTotal: number;
  unread24h: number;
  unread7d: number;
  highFitUnread7d: number;
};

export const resolveDashboardDayRange = (cookieHeader: string | null, referenceAt = Date.now()): DashboardDayRange => {
  const tzCookie = getCookieValue(cookieHeader, 'nebular_tz_offset_min');
  const tzOffsetMinutes = clampTimezoneOffsetMinutes(tzCookie, 0);
  const { dayStart, dayEnd } = dayRangeForTimezoneOffset(referenceAt, tzOffsetMinutes);
  return {
    dayStart,
    dayEnd,
    tzOffsetMinutes
  };
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

export async function getDashboardUnreadQueue(
  db: Db,
  options: {
    windowDays: number;
    scoreCutoff: number;
    limit: number;
    referenceAt?: number;
  }
): Promise<DashboardUnreadQueueArticle[]> {
  const toBoundedInt = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };

  const safeWindowDays = toBoundedInt(options.windowDays, 1, 30, 7);
  const safeLimit = toBoundedInt(options.limit, 1, 20, 6);
  const scoreCutoff = toBoundedInt(options.scoreCutoff, 1, 5, 3);
  const referenceAt = options.referenceAt ?? Date.now();
  const windowStart = referenceAt - safeWindowDays * DAY_MS;

  const rows = await dbAll<{
    id: string;
    title: string | null;
    canonical_url: string | null;
    image_url: string | null;
    published_at: number | null;
    fetched_at: number | null;
    excerpt: string | null;
    summary_text: string | null;
    score: number | null;
    label: string | null;
  }>(
    db,
    `WITH latest_summaries AS (
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
     FROM articles a
     LEFT JOIN latest_summaries ls ON ls.article_id = a.id
     LEFT JOIN latest_scores lsc ON lsc.article_id = a.id
     LEFT JOIN article_score_overrides o ON o.article_id = a.id
     WHERE COALESCE(a.published_at, a.fetched_at, 0) >= ?
       AND COALESCE(
         (SELECT rs.is_read FROM article_read_state rs WHERE rs.article_id = a.id LIMIT 1),
         0
       ) = 0
     ORDER BY
       CASE WHEN COALESCE(o.score, lsc.score) >= ? THEN 0 ELSE 1 END ASC,
       CASE WHEN COALESCE(o.score, lsc.score) IS NULL THEN 1 ELSE 0 END ASC,
       COALESCE(o.score, lsc.score) DESC,
       COALESCE(a.published_at, a.fetched_at) DESC
     LIMIT ?`,
    [windowStart, scoreCutoff, safeLimit]
  );

  const sourceByArticle = await getPreferredSourcesForArticles(
    db,
    rows.map((row) => row.id)
  );

  return rows.map((row) => {
    const source = sourceByArticle.get(row.id);
    return {
      ...row,
      queue_reason: Number(row.score) >= scoreCutoff ? 'high_fit' : 'recent_unread',
      source_name: source?.sourceName ?? null
    };
  });
}

export async function getDashboardReadingMomentum(
  db: Db,
  options: {
    scoreCutoff: number;
    referenceAt?: number;
  }
): Promise<DashboardReadingMomentum> {
  const scoreCutoff = Math.max(1, Math.min(5, Math.round(Number(options.scoreCutoff) || 3)));
  const referenceAt = options.referenceAt ?? Date.now();
  const last24hStart = referenceAt - DAY_MS;
  const last7dStart = referenceAt - 7 * DAY_MS;

  const row = await dbGet<{
    unread_total: number | null;
    unread_24h: number | null;
    unread_7d: number | null;
    high_fit_unread_7d: number | null;
  }>(
    db,
    `WITH latest_scores AS (
       SELECT sc.article_id, sc.score
       FROM article_scores sc
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_scores
         GROUP BY article_id
       ) latest
         ON latest.article_id = sc.article_id
        AND latest.created_at = sc.created_at
     ),
     unread_articles AS (
       SELECT
         a.id,
         COALESCE(a.published_at, a.fetched_at) as article_at,
         COALESCE(o.score, lsc.score) as score
       FROM articles a
       LEFT JOIN article_score_overrides o ON o.article_id = a.id
       LEFT JOIN latest_scores lsc ON lsc.article_id = a.id
       WHERE COALESCE(
         (SELECT rs.is_read FROM article_read_state rs WHERE rs.article_id = a.id LIMIT 1),
         0
       ) = 0
     )
     SELECT
       COUNT(*) as unread_total,
       SUM(CASE WHEN article_at >= ? THEN 1 ELSE 0 END) as unread_24h,
       SUM(CASE WHEN article_at >= ? THEN 1 ELSE 0 END) as unread_7d,
       SUM(CASE WHEN article_at >= ? AND score >= ? THEN 1 ELSE 0 END) as high_fit_unread_7d
     FROM unread_articles`,
    [last24hStart, last7dStart, last7dStart, scoreCutoff]
  );

  return {
    unreadTotal: Number(row?.unread_total ?? 0),
    unread24h: Number(row?.unread_24h ?? 0),
    unread7d: Number(row?.unread_7d ?? 0),
    highFitUnread7d: Number(row?.high_fit_unread_7d ?? 0)
  };
}

export async function getDashboardFeedStatus(db: Db): Promise<{ feedCount: number; hasFeeds: boolean }> {
  const row = await dbGet<{ feed_count: number | null }>(db, 'SELECT COUNT(*) as feed_count FROM feeds');
  const feedCount = Number(row?.feed_count ?? 0);
  return {
    feedCount,
    hasFeeds: feedCount > 0
  };
}
