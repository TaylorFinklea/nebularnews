import { json, type RequestEvent } from '@sveltejs/kit';

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

const randomPart = () => Math.random().toString(36).slice(2, 10);

export const createRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${randomPart()}`;
};

const requestIdFromEvent = (event?: RequestEvent) => event?.locals.requestId ?? createRequestId();

export const apiOk = <T>(event: RequestEvent, data: T, init?: ResponseInit) => {
  const requestId = requestIdFromEvent(event);
  return json(
    {
      ok: true,
      data,
      request_id: requestId
    } satisfies ApiEnvelope<T>,
    init
  );
};

export const apiOkWithAliases = <T extends Record<string, unknown>, A extends Record<string, unknown>>(
  event: RequestEvent,
  data: T,
  aliases: A,
  init?: ResponseInit
) => {
  const requestId = requestIdFromEvent(event);
  return json(
    {
      ok: true,
      data,
      request_id: requestId,
      ...aliases
    },
    init
  );
};

export const apiError = (
  event: RequestEvent,
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown
) => {
  const requestId = requestIdFromEvent(event);
  return json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {})
      },
      request_id: requestId
    } satisfies ApiEnvelope<never>,
    { status }
  );
};
