import { dbGet } from '$lib/server/db';
import { getManualPullState } from '$lib/server/manual-pull';

const POLL_MS = 5000;
const STREAM_MAX_MS = 55_000;

const encoder = new TextEncoder();

const sseEvent = (event: string, data: unknown) => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const GET = async ({ platform, request }) => {
  const db = platform.env.DB;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let inFlight = false;
      const sendSnapshot = async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          const pull = await getManualPullState(db);
          const counts = await dbGet<{
            pending: number | null;
            running: number | null;
            failed: number | null;
            done: number | null;
          }>(
            db,
            `SELECT
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
              COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running,
              COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
              COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) as done
             FROM jobs`
          );

          controller.enqueue(
            sseEvent('state', {
              ts: Date.now(),
              pull: {
                run_id: pull.runId,
                status: pull.status,
                in_progress: pull.inProgress,
                started_at: pull.startedAt,
                completed_at: pull.completedAt,
                last_run_status: pull.lastRunStatus,
                last_error: pull.lastError
              },
              jobs: {
                pending: Number(counts?.pending ?? 0),
                running: Number(counts?.running ?? 0),
                failed: Number(counts?.failed ?? 0),
                done: Number(counts?.done ?? 0)
              }
            })
          );
        } catch (error) {
          controller.enqueue(
            sseEvent('error', {
              message: error instanceof Error ? error.message : 'SSE refresh failed'
            })
          );
        } finally {
          inFlight = false;
        }
      };

      void sendSnapshot();
      const timer = setInterval(() => {
        void sendSnapshot();
      }, POLL_MS);
      const timeout = setTimeout(() => {
        close();
      }, STREAM_MAX_MS);

      const close = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // Ignore stream close races.
        }
      };

      request.signal.addEventListener('abort', close);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  });
};
