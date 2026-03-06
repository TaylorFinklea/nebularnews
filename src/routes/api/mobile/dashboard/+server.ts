import { json } from '@sveltejs/kit';
import { getDashboardFeedStatus, getDashboardReadingMomentum, getDashboardUnreadQueue } from '$lib/server/dashboard';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getDashboardQueueConfig } from '$lib/server/settings';
import { getDashboardNewsBrief } from '$lib/server/news-brief';

export const GET = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');

  const db = platform.env.DB;
  const referenceAt = Date.now();
  const queueConfig = await getDashboardQueueConfig(db);
  const [feedStatus, newsBrief, readingQueue, momentum] = await Promise.all([
    getDashboardFeedStatus(db),
    getDashboardNewsBrief(db, platform.env, referenceAt),
    getDashboardUnreadQueue(db, {
      windowDays: queueConfig.windowDays,
      scoreCutoff: queueConfig.scoreCutoff,
      limit: queueConfig.limit,
      referenceAt
    }),
    getDashboardReadingMomentum(db, {
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
