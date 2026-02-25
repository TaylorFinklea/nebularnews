import { dbGet } from '$lib/server/db';
import { getJobCounts, listJobs, normalizeJobFilter } from '$lib/server/jobs-admin';
import { parse as parseCookie } from 'cookie';
import { clampTimezoneOffsetMinutes, dayRangeForTimezoneOffset } from '$lib/server/time';
import { isEventsV2Enabled } from '$lib/server/flags';
import { getAutoTaggingEnabled } from '$lib/server/settings';

export const load = async ({ platform, url, request, depends }) => {
  depends('app:jobs');
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
  const todayMissingAutoTags = await dbGet<{ count: number }>(
    platform.env.DB,
    `SELECT COUNT(*) as count
     FROM articles a
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND COALESCE(a.published_at, a.fetched_at) < ?
       AND NOT EXISTS (
         SELECT 1
         FROM article_tags t
         WHERE t.article_id = a.id
           AND t.source = 'ai'
       )`,
    [dayStart, dayEnd]
  );
  const autoTaggingEnabled = await getAutoTaggingEnabled(platform.env.DB);

  return {
    jobs,
    counts,
    status,
    liveEventsEnabled: isEventsV2Enabled(platform.env),
    today: {
      missingSummaries: todayMissingSummaries?.count ?? 0,
      missingScores: todayMissingScores?.count ?? 0,
      missingAutoTags: autoTaggingEnabled ? todayMissingAutoTags?.count ?? 0 : 0,
      autoTaggingEnabled,
      tzOffsetMinutes
    }
  };
};
