import { json } from '@sveltejs/kit';
import { getDashboardFeedStatus, getDashboardReadingMomentum, getDashboardUnreadQueue } from '$lib/server/dashboard';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getDashboardQueueConfig } from '$lib/server/settings';
import { getDashboardNewsBrief } from '$lib/server/news-brief';

export const GET = async ({ request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:read');

  const db = locals.db;
  const cache = locals.settingsCache;
  const referenceAt = Date.now();
  const queueConfig = await getDashboardQueueConfig(db, cache);
  const [feedStatus, newsBrief, readingQueue, momentum] = await Promise.all([
    getDashboardFeedStatus(db),
    getDashboardNewsBrief(db, locals.env, referenceAt, user.id),
    getDashboardUnreadQueue(db, user.id, {
      windowDays: queueConfig.windowDays,
      scoreCutoff: queueConfig.scoreCutoff,
      limit: queueConfig.limit,
      referenceAt
    }),
    getDashboardReadingMomentum(db, user.id, {
      scoreCutoff: queueConfig.scoreCutoff,
      referenceAt
    })
  ]);

  return json({
    hasFeeds: feedStatus.hasFeeds,
    queueConfig,
    newsBrief,
    readingQueue,
    momentum
  });
};
