import { apiOkWithAliases } from '$lib/server/api';
import { getLiveHeartbeat, type LiveHeartbeatPayload } from '$lib/server/live-heartbeat';
import { logInfo, logWarn } from '$lib/server/log';

const HEARTBEAT_ROUTE_BUDGET_MS = 1200;

export const GET = async (event) => {
  const startedAt = Date.now();
  let data: LiveHeartbeatPayload;
  try {
    data = await getLiveHeartbeat(event.platform.env.DB, event.request.headers.get('cookie'), {
      requestId: event.locals.requestId,
      budgetMs: HEARTBEAT_ROUTE_BUDGET_MS,
      startedAt
    });
  } catch (error) {
    data = {
      pull: {
        run_id: null,
        status: null,
        in_progress: false,
        started_at: null,
        completed_at: null,
        last_run_status: null,
        last_error: null
      },
      jobs: {
        pending: 0,
        running: 0,
        failed: 0,
        done: 0
      },
      today: {
        articles: 0,
        summaries: 0,
        scores: 0,
        pendingJobs: 0,
        missingSummaries: 0,
        missingScores: 0,
        tzOffsetMinutes: 0
      },
      refreshed_at: Date.now(),
      degraded: true,
      degraded_reason: 'heartbeat_exception'
    };
    logWarn('live.heartbeat.degraded', {
      request_id: event.locals.requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  const durationMs = Date.now() - startedAt;

  logInfo('live.heartbeat.completed', {
    request_id: event.locals.requestId,
    duration_ms: durationMs,
    degraded: data.degraded,
    degraded_reason: data.degraded_reason,
    pull_status: data.pull.status,
    pull_in_progress: data.pull.in_progress
  });

  return apiOkWithAliases(
    event,
    data,
    {
      ...data,
      server_timing_ms: durationMs
    },
    {
      'server-timing': `heartbeat;dur=${durationMs}`
    }
  );
};
