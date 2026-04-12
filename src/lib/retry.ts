/**
 * Retry helper with exponential backoff for AI calls.
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10_000,
};

/**
 * Execute `fn` with exponential backoff retries.
 *
 * Retries on any thrown error. Does not retry on AbortError (timeout).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const { maxAttempts, initialDelayMs, maxDelayMs } = { ...DEFAULTS, ...opts };
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry aborts (timeout) or final attempt.
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort || attempt === maxAttempts) break;

      // Exponential backoff with jitter.
      const delay = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }

  throw lastError;
}
