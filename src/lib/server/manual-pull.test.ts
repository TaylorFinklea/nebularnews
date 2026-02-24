import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  nowMs: 1_700_000_000_000,
  run: null as
    | {
        id: string;
        status: 'queued' | 'running' | 'success' | 'failed';
        trigger: string;
        cycles: number;
        started_at: number | null;
        completed_at: number | null;
        last_error: string | null;
        request_id: string | null;
        stats_json: string | null;
        created_at: number;
        updated_at: number;
      }
    | null
}));

const dbRunMock = vi.hoisted(() => vi.fn());
const dbGetMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  now: () => harness.nowMs,
  dbRun: dbRunMock,
  dbGet: dbGetMock
}));

vi.mock('./log', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn()
}));

import { getManualPullState } from './manual-pull';

describe('getManualPullState', () => {
  beforeEach(() => {
    dbRunMock.mockReset();
    dbGetMock.mockReset();
    harness.run = null;

    dbRunMock.mockImplementation(async (_db, sql: string, params: unknown[]) => {
      if (!harness.run) return { meta: { changes: 0 } };
      if (!sql.includes("SET status = 'failed'")) return { meta: { changes: 0 } };

      const staleBefore = Number(params?.[3]);
      if (
        (harness.run.status === 'queued' || harness.run.status === 'running') &&
        harness.run.updated_at < staleBefore
      ) {
        harness.run = {
          ...harness.run,
          status: 'failed',
          completed_at: Number(params?.[0]),
          last_error: String(params?.[1] ?? ''),
          updated_at: Number(params?.[2])
        };
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    });

    dbGetMock.mockImplementation(async (_db, sql: string, params: unknown[] = []) => {
      if (!harness.run) return null;
      if (sql.includes('WHERE id = ?')) {
        return harness.run.id === params?.[0] ? harness.run : null;
      }
      return harness.run;
    });
  });

  it('does not mutate stale runs in read path', async () => {
    harness.run = {
      id: 'pull-1',
      status: 'running',
      trigger: 'api',
      cycles: 1,
      started_at: harness.nowMs - 3_600_000,
      completed_at: null,
      last_error: null,
      request_id: 'req-1',
      stats_json: null,
      created_at: harness.nowMs - 3_600_000,
      updated_at: harness.nowMs - 3_600_000
    };

    const state = await getManualPullState({} as D1Database);

    expect(state.runId).toBe('pull-1');
    expect(state.status).toBe('running');
    expect(state.inProgress).toBe(true);
    expect(state.lastRunStatus).toBe(null);
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('keeps recently updated running runs in progress', async () => {
    harness.run = {
      id: 'pull-2',
      status: 'running',
      trigger: 'api',
      cycles: 1,
      started_at: harness.nowMs - 60_000,
      completed_at: null,
      last_error: null,
      request_id: 'req-2',
      stats_json: null,
      created_at: harness.nowMs - 60_000,
      updated_at: harness.nowMs - 60_000
    };

    const state = await getManualPullState({} as D1Database);

    expect(state.runId).toBe('pull-2');
    expect(state.status).toBe('running');
    expect(state.inProgress).toBe(true);
    expect(state.lastRunStatus).toBe(null);
  });
});
