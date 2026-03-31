import { json } from '@sveltejs/kit';

export const GET = async ({ locals }) => {
  const db = locals.db;
  const userId = 'fdza0l143AQyRzy_WbIMW';
  const start = Date.now();
  const results: Record<string, unknown> = {};

  try {
    const { getDashboardQueueConfig } = await import('$lib/server/settings');
    const queueConfig = await getDashboardQueueConfig(db, locals.settingsCache);
    results.queueConfig = { ok: true, ms: Date.now() - start, value: queueConfig };
  } catch (err) {
    results.queueConfig = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { getDashboardFeedStatus } = await import('$lib/server/dashboard');
    const t = Date.now();
    const feedStatus = await getDashboardFeedStatus(db);
    results.feedStatus = { ok: true, ms: Date.now() - t, value: feedStatus };
  } catch (err) {
    results.feedStatus = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { getDashboardReadingMomentum } = await import('$lib/server/dashboard');
    const t = Date.now();
    const momentum = await getDashboardReadingMomentum(db, userId, {
      scoreCutoff: 3,
      referenceAt: Date.now()
    });
    results.momentum = { ok: true, ms: Date.now() - t };
  } catch (err) {
    results.momentum = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { getDashboardUnreadQueue } = await import('$lib/server/dashboard');
    const t = Date.now();
    const queue = await getDashboardUnreadQueue(db, userId, {
      windowDays: 7,
      scoreCutoff: 3,
      limit: 6,
      referenceAt: Date.now()
    });
    results.unreadQueue = { ok: true, ms: Date.now() - t, count: queue.length };
  } catch (err) {
    results.unreadQueue = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { getDashboardNewsBrief } = await import('$lib/server/news-brief');
    const t = Date.now();
    const brief = await getDashboardNewsBrief(db, locals.env, Date.now(), userId);
    results.newsBrief = { ok: true, ms: Date.now() - t, state: brief?.state };
  } catch (err) {
    results.newsBrief = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  results.totalMs = Date.now() - start;
  return json(results);
};
