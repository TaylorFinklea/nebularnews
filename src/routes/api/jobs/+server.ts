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
import { apiError, apiOkWithAliases } from '$lib/server/api';
import { logInfo } from '$lib/server/log';

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

export const GET = async (event) => {
  const { url, platform } = event;
  const status = normalizeJobFilter(url.searchParams.get('status'));
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const jobs = await listJobs(platform.env.DB, { status, limit });
  const counts = await getJobCounts(platform.env.DB);
  return apiOkWithAliases(
    event,
    {
      jobs,
      counts,
      status
    },
    { jobs, counts, status }
  );
};

export const POST = async (event) => {
  const { request, platform } = event;
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!validActions.has(action)) {
    return apiError(event, 400, 'validation_error', 'Invalid action');
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
    logInfo('jobs.admin.action', {
      request_id: event.locals.requestId,
      action,
      cycles: result.cycles,
      counts: result.counts
    });
    return apiOkWithAliases(
      event,
      {
        action,
        cycles: result.cycles,
        counts: result.counts,
        metrics: result.metrics
      },
      {
        action,
        cycles: result.cycles,
        counts: result.counts,
        metrics: result.metrics
      }
    );
  }

  if (action === 'retry_failed') {
    const updated = await retryFailedJobs(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts });
  }

  if (action === 'cancel_pending_all') {
    const updated = await cancelAllPendingJobs(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts });
  }

  if (action === 'clear_finished') {
    const deleted = await clearFinishedJobs(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, deleted, counts }, { action, deleted, counts });
  }

  if (action === 'queue_today_missing') {
    const queued = await queueMissingTodayArticleJobs(db, { tzOffsetMinutes });
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, queued, counts }, { action, queued, counts });
  }

  if (!jobId) {
    return apiError(event, 400, 'validation_error', 'Missing jobId');
  }

  if (action === 'run_now') {
    const updated = await markJobPendingNow(db, jobId);
    if (!updated) {
      const status = await getJobStatus(db, jobId);
      if (!status) return apiError(event, 404, 'not_found', 'Job not found');
      if (status === 'running') return apiError(event, 409, 'conflict', 'Job is currently running');
      return apiError(event, 409, 'conflict', 'No changes made');
    }
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts });
  }

  if (action === 'cancel') {
    const updated = await cancelPendingJob(db, jobId);
    if (!updated) {
      const status = await getJobStatus(db, jobId);
      if (!status) return apiError(event, 404, 'not_found', 'Job not found');
      if (status === 'running') return apiError(event, 409, 'conflict', 'Cannot cancel a running job');
      return apiError(event, 409, 'conflict', `Job is ${status}, only pending jobs can be cancelled`);
    }
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts });
  }

  const deleted = await deleteJob(db, jobId);
  if (!deleted) {
    const status = await getJobStatus(db, jobId);
    if (!status) return apiError(event, 404, 'not_found', 'Job not found');
    if (status === 'running') return apiError(event, 409, 'conflict', 'Cannot delete a running job');
    return apiError(event, 409, 'conflict', 'No changes made');
  }
  const counts = await getJobCounts(db);
  return apiOkWithAliases(event, { action, deleted, counts }, { action, deleted, counts });
};
