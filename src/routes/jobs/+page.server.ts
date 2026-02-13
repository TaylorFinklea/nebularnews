import { dbGet } from '$lib/server/db';
import { getJobCounts, listJobs, normalizeJobFilter } from '$lib/server/jobs-admin';
import { parse as parseCookie } from 'cookie';
import { clampTimezoneOffsetMinutes, dayRangeForTimezoneOffset } from '$lib/server/time';

export const load = async ({ platform, url, request }) => {
  const status = normalizeJobFilter(url.searchParams.get('status') ?? 'pending');
  const jobs = await listJobs(platform.env.DB, { status, limit: 150 });
  const counts = await getJobCounts(platform.env.DB);
  const cookies = parseCookie(request.headers.get('cookie') ?? '');
  const tzOffsetMinutes = clampTimezoneOffsetMinutes(cookies.nebular_tz_offset_min, 0);
  const { dayStart, dayEnd } = dayRangeForTimezoneOffset(Date.now(), tzOffsetMinutes);
  const todayMissingSummaries = await dbGet<{ count: number }>(
    platform.env.DB,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND NOT EXISTS (SELECT 1 FROM article_summaries s WHERE s.article_id = a.id)`,
    [dayStart, dayEnd]
  );
  const todayMissingScores = await dbGet<{ count: number }>(
    platform.env.DB,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND NOT EXISTS (SELECT 1 FROM article_scores s WHERE s.article_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM article_score_overrides o WHERE o.article_id = a.id)`,
    [dayStart, dayEnd]
  );

  return {
    jobs,
    counts,
    status,
    today: {
      missingSummaries: todayMissingSummaries?.count ?? 0,
      missingScores: todayMissingScores?.count ?? 0,
      tzOffsetMinutes
    }
  };
};
