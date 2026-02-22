import type { ApiEnvelope, MutationResult } from '$lib/types/api';

const pendingMutations = new Set<string>();

const readPayload = async (response: Response) => {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
};

const extractSuccessData = <T>(payload: unknown): T | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (record.ok === true && record.data && typeof record.data === 'object') {
    return record.data as T;
  }
  // Compatibility with legacy response shapes that returned raw fields at top-level.
  if (record.ok === true) {
    return record as unknown as T;
  }
  return undefined;
};

const extractError = (payload: unknown, fallbackMessage: string) => {
  if (!payload || typeof payload !== 'object') {
    return { message: fallbackMessage };
  }
  const record = payload as Record<string, unknown>;
  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const nested = nestedError as Record<string, unknown>;
    const message = typeof nested.message === 'string' ? nested.message : fallbackMessage;
    const code = typeof nested.code === 'string' ? nested.code : undefined;
    return {
      code,
      message,
      details: nested.details
    };
  }
  if (typeof record.error === 'string') {
    return { message: record.error };
  }
  return { message: fallbackMessage };
};

export type OptimisticMutationOptions<TData> = {
  key: string;
  request: () => Promise<Response>;
  applyOptimistic: () => void;
  revertOptimistic: () => void;
  successFallbackData?: TData;
  fallbackErrorMessage: string;
};

export const runOptimisticMutation = async <TData>(
  options: OptimisticMutationOptions<TData>
): Promise<MutationResult<TData> & { skipped?: boolean }> => {
  if (pendingMutations.has(options.key)) {
    return { ok: false, status: 0, error: { message: 'pending' }, skipped: true };
  }

  pendingMutations.add(options.key);
  options.applyOptimistic();

  try {
    const response = await options.request();
    const payload = await readPayload(response);
    const requestId =
      payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).request_id === 'string'
        ? String((payload as Record<string, unknown>).request_id)
        : null;

    if (!response.ok) {
      options.revertOptimistic();
      return {
        ok: false,
        status: response.status,
        requestId,
        error: extractError(payload, options.fallbackErrorMessage)
      };
    }

    const data = extractSuccessData<TData>(payload) ?? options.successFallbackData;
    return {
      ok: true,
      status: response.status,
      requestId,
      data
    };
  } catch {
    options.revertOptimistic();
    return {
      ok: false,
      status: 0,
      error: { message: options.fallbackErrorMessage }
    };
  } finally {
    pendingMutations.delete(options.key);
  }
};

export const isMutationPending = (key: string) => pendingMutations.has(key);

export const clearAllMutationPending = () => {
  pendingMutations.clear();
};

export type MutatingApiResponse<T> = ApiEnvelope<T> | ({ ok: true } & T);

