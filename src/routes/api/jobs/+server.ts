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
  queueMissingRecentArticleJobs,
  queueMissingKeyPoints,
  queueRefetchContent,
  retryFailedJobs,
  runQueueCycles
} from '$lib/server/jobs-admin';
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
  'queue_recent_missing',
  'queue_today_missing',
  'backfill_key_points',
  'refetch_missing_content'
]);
const noStoreHeaders = { 'cache-control': 'no-store' };

export const GET = async (event) => {
  const { url, locals } = event;
  const status = normalizeJobFilter(url.searchParams.get('status'));
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const jobs = await listJobs(locals.db, { status, limit });
  const counts = await getJobCounts(locals.db);
  return apiOkWithAliases(
    event,
    {
      jobs,
      counts,
      status
    },
    { jobs, counts, status },
    { headers: noStoreHeaders }
  );
};

export const POST = async (event) => {
  const { request, locals } = event;
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!validActions.has(action)) {
    return apiError(event, 400, 'validation_error', 'Invalid action');
  }

  const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : '';
  const db = locals.db;

  if (action === 'run_queue') {
    const cycles = clampQueueCycles(body?.cycles ?? 1);
    const forceDue = body?.forceDue !== false;
    const result = await runQueueCycles(locals.db, locals.env, cycles, { forceDue });
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
      },
      { headers: noStoreHeaders }
    );
  }

  if (action === 'retry_failed') {
    const updated = await retryFailedJobs(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts }, { headers: noStoreHeaders });
  }

  if (action === 'cancel_pending_all') {
    const updated = await cancelAllPendingJobs(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts }, { headers: noStoreHeaders });
  }

  if (action === 'clear_finished') {
    const deleted = await clearFinishedJobs(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, deleted, counts }, { action, deleted, counts }, { headers: noStoreHeaders });
  }

  if (action === 'queue_recent_missing' || action === 'queue_today_missing') {
    const queued = await queueMissingRecentArticleJobs(db, { lookbackHours: 72 });
    const counts = await getJobCounts(db);
    return apiOkWithAliases(
      event,
      { action: 'queue_recent_missing', queued, counts },
      { action: 'queue_recent_missing', queued, counts },
      { headers: noStoreHeaders }
    );
  }

  if (action === 'backfill_key_points') {
    const result = await queueMissingKeyPoints(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, ...result, counts }, { action, ...result, counts }, { headers: noStoreHeaders });
  }

  if (action === 'refetch_missing_content') {
    const result = await queueRefetchContent(db);
    const counts = await getJobCounts(db);
    return apiOkWithAliases(event, { action, ...result, counts }, { action, ...result, counts }, { headers: noStoreHeaders });
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
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts }, { headers: noStoreHeaders });
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
    return apiOkWithAliases(event, { action, updated, counts }, { action, updated, counts }, { headers: noStoreHeaders });
  }

  const deleted = await deleteJob(db, jobId);
  if (!deleted) {
    const status = await getJobStatus(db, jobId);
    if (!status) return apiError(event, 404, 'not_found', 'Job not found');
    if (status === 'running') return apiError(event, 409, 'conflict', 'Cannot delete a running job');
    return apiError(event, 409, 'conflict', 'No changes made');
  }
  const counts = await getJobCounts(db);
  return apiOkWithAliases(event, { action, deleted, counts }, { action, deleted, counts }, { headers: noStoreHeaders });
};
