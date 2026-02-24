export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'bad_request'
  | 'validation_error'
  | 'schema_not_ready'
  | 'internal_error';

export type ApiEnvelope<T> =
  | {
      ok: true;
      data: T;
      request_id: string;
    }
  | {
      ok: false;
      error: {
        code: ApiErrorCode;
        message: string;
        details?: unknown;
      };
      request_id: string;
    };

export type MutationResult<T> = {
  ok: boolean;
  status: number;
  requestId?: string | null;
  data?: T;
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
};

export type LiveHeartbeatPayload = {
  pull: {
    run_id: string | null;
    status: string | null;
    in_progress: boolean;
    started_at: number | null;
    completed_at: number | null;
    last_run_status: 'success' | 'failed' | null;
    last_error: string | null;
  };
  jobs: {
    pending: number;
    running: number;
    failed: number;
    done: number;
  };
  today: {
    articles: number;
    summaries: number;
    scores: number;
    pendingJobs: number;
    missingSummaries: number;
    missingScores: number;
    tzOffsetMinutes: number;
  };
  refreshed_at: number;
  degraded: boolean;
  degraded_reason: string | null;
};
