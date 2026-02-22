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

