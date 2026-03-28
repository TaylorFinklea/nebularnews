import { json } from '@sveltejs/kit';
import { getDashboardFeedStatus, getDashboardReadingMomentum, getDashboardUnreadQueue } from '$lib/server/dashboard';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getDashboardQueueConfig } from '$lib/server/settings';
import { getDashboardNewsBrief } from '$lib/server/news-brief';

export const GET = async ({ request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:read');

  const db = locals.db;
  const referenceAt = Date.now();
  const queueConfig = await getDashboardQueueConfig(db);
  const [feedStatus, newsBrief, readingQueue, momentum] = await Promise.all([
    getDashboardFeedStatus(db),
    getDashboardNewsBrief(db, platform.env, referenceAt, user.id),
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
