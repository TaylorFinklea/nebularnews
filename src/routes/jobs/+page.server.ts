import { dbGet } from '$lib/server/db';
import { getJobCounts, listJobs, normalizeJobFilter } from '$lib/server/jobs-admin';
import { isEventsV2Enabled } from '$lib/server/flags';

const RECENT_MISSING_LOOKBACK_HOURS = 72;

export const load = async ({ platform, url, depends }) => {
  depends('app:jobs');
  const status = normalizeJobFilter(url.searchParams.get('status') ?? 'pending');
  const jobs = await listJobs(platform.env.DB, { status, limit: 150 });
  const counts = await getJobCounts(platform.env.DB);
  const recentCutoff = Date.now() - RECENT_MISSING_LOOKBACK_HOURS * 60 * 60 * 1000;
  const recentMissing = await dbGet<{
    recent_articles: number | null;
    missing_scores: number | null;
    missing_auto_tags: number | null;
    missing_image_backfill: number | null;
  }>(
    platform.env.DB,
    `WITH recent_articles AS (
       SELECT id, image_status
       FROM articles
       WHERE COALESCE(published_at, fetched_at, 0) >= ?
     )
     SELECT
       COUNT(*) AS recent_articles,
       COALESCE(SUM(CASE
         WHEN EXISTS (SELECT 1 FROM article_scores s WHERE s.article_id = a.id)
           OR EXISTS (SELECT 1 FROM article_score_overrides o WHERE o.article_id = a.id)
           OR EXISTS (
             SELECT 1 FROM jobs j
             WHERE j.article_id = a.id
               AND j.type = 'score'
               AND j.status IN ('pending', 'running', 'done')
           )
         THEN 0 ELSE 1 END), 0) AS missing_scores,
       COALESCE(SUM(CASE
         WHEN EXISTS (
           SELECT 1
           FROM article_tags t
           WHERE t.article_id = a.id
             AND t.source IN ('ai', 'system')
         ) OR EXISTS (
           SELECT 1 FROM jobs j
           WHERE j.article_id = a.id
             AND j.type = 'auto_tag'
             AND j.status IN ('pending', 'running', 'done')
         )
         THEN 0 ELSE 1 END), 0) AS missing_auto_tags,
       COALESCE(SUM(CASE
         WHEN COALESCE(a.image_status, '') IN ('found', 'missing')
           OR EXISTS (
             SELECT 1 FROM jobs j
             WHERE j.article_id = a.id
               AND j.type = 'image_backfill'
               AND j.status IN ('pending', 'running', 'done')
           )
         THEN 0 ELSE 1 END), 0) AS missing_image_backfill
     FROM recent_articles a`,
    [recentCutoff]
  );

  return {
    jobs,
    counts,
    status,
    liveEventsEnabled: isEventsV2Enabled(platform.env),
    recent: {
      lookbackHours: RECENT_MISSING_LOOKBACK_HOURS,
      articleCount: recentMissing?.recent_articles ?? 0,
      missingScores: recentMissing?.missing_scores ?? 0,
      missingAutoTags: recentMissing?.missing_auto_tags ?? 0,
      missingImageBackfill: recentMissing?.missing_image_backfill ?? 0
    }
  };
};
