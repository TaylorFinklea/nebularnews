import { json } from '@sveltejs/kit';
import { parse as parseCookie } from 'cookie';
import {
  cancelAllPendingJobs,
  cancelPendingJob,
  clearFinishedJobs,
  clampQueueCycles,
  deleteJob,
  getJobCounts,
  getJobStatus,
  listJobs,
  markJobPendingNow,
  normalizeJobFilter,
  queueMissingTodayArticleJobs,
  retryFailedJobs,
  runQueueCycles
} from '$lib/server/jobs-admin';
import { clampTimezoneOffsetMinutes } from '$lib/server/time';

const validActions = new Set([
  'run_queue',
  'run_now',
  'cancel',
  'delete',
  'retry_failed',
  'cancel_pending_all',
  'clear_finished',
  'queue_today_missing'
]);

export const GET = async ({ url, platform }) => {
  const status = normalizeJobFilter(url.searchParams.get('status'));
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const jobs = await listJobs(platform.env.DB, { status, limit });
  const counts = await getJobCounts(platform.env.DB);
  return json({ jobs, counts, status });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!validActions.has(action)) {
    return json({ error: 'Invalid action' }, { status: 400 });
  }

  const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : '';
  const db = platform.env.DB;
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = parseCookie(cookieHeader);
  const requestedOffset =
    body?.tzOffsetMinutes ??
    body?.timezoneOffsetMinutes ??
    (cookies.nebular_tz_offset_min ? Number(cookies.nebular_tz_offset_min) : undefined);
  const tzOffsetMinutes = clampTimezoneOffsetMinutes(requestedOffset, 0);

  if (action === 'run_queue') {
    const cycles = clampQueueCycles(body?.cycles ?? 1);
    const forceDue = body?.forceDue !== false;
    const result = await runQueueCycles(platform.env, cycles, { forceDue });
    return json({ ok: true, action, cycles: result.cycles, counts: result.counts });
  }

  if (action === 'retry_failed') {
    const updated = await retryFailedJobs(db);
    return json({ ok: true, action, updated, counts: await getJobCounts(db) });
  }

  if (action === 'cancel_pending_all') {
    const updated = await cancelAllPendingJobs(db);
    return json({ ok: true, action, updated, counts: await getJobCounts(db) });
  }

  if (action === 'clear_finished') {
    const deleted = await clearFinishedJobs(db);
    return json({ ok: true, action, deleted, counts: await getJobCounts(db) });
  }

  if (action === 'queue_today_missing') {
    const queued = await queueMissingTodayArticleJobs(db, { tzOffsetMinutes });
    return json({
      ok: true,
      action,
      queued,
      counts: await getJobCounts(db)
    });
  }

  if (!jobId) {
    return json({ error: 'Missing jobId' }, { status: 400 });
  }

  if (action === 'run_now') {
    const updated = await markJobPendingNow(db, jobId);
    if (!updated) {
      const status = await getJobStatus(db, jobId);
      if (!status) return json({ error: 'Job not found' }, { status: 404 });
      if (status === 'running') return json({ error: 'Job is currently running' }, { status: 409 });
      return json({ error: 'No changes made' }, { status: 409 });
    }
    return json({ ok: true, action, updated, counts: await getJobCounts(db) });
  }

  if (action === 'cancel') {
    const updated = await cancelPendingJob(db, jobId);
    if (!updated) {
      const status = await getJobStatus(db, jobId);
      if (!status) return json({ error: 'Job not found' }, { status: 404 });
      if (status === 'running') return json({ error: 'Cannot cancel a running job' }, { status: 409 });
      return json({ error: `Job is ${status}, only pending jobs can be cancelled` }, { status: 409 });
    }
    return json({ ok: true, action, updated, counts: await getJobCounts(db) });
  }

  const deleted = await deleteJob(db, jobId);
  if (!deleted) {
    const status = await getJobStatus(db, jobId);
    if (!status) return json({ error: 'Job not found' }, { status: 404 });
    if (status === 'running') return json({ error: 'Cannot delete a running job' }, { status: 409 });
    return json({ error: 'No changes made' }, { status: 409 });
  }
  return json({ ok: true, action, deleted, counts: await getJobCounts(db) });
};
