import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { createSessionCookie, verifyPassword } from '$lib/server/auth';
import { buildCsrfCookie, createCsrfToken } from '$lib/server/security';
import { clearLoginAttempts, getAuthIdentifier, getThrottleRemainingMs, registerFailedLogin } from '$lib/server/login-throttle';
import { recordAuditEvent } from '$lib/server/audit';

vi.mock('$lib/server/auth', () => ({
  createSessionCookie: vi.fn(async () => 'nn_session=test; Path=/; HttpOnly'),
  verifyPassword: vi.fn(async () => true)
}));

vi.mock('$lib/server/security', () => ({
  buildCsrfCookie: vi.fn(() => 'nn_csrf=test; Path=/'),
  createCsrfToken: vi.fn(() => 'csrf-token')
}));

vi.mock('$lib/server/login-throttle', () => ({
  clearLoginAttempts: vi.fn(async () => undefined),
  getAuthIdentifier: vi.fn(() => 'ip'),
  getThrottleRemainingMs: vi.fn(async () => 0),
  registerFailedLogin: vi.fn(async () => ({ failedCount: 1, blockedUntil: null, remainingMs: 0 }))
}));

vi.mock('$lib/server/audit', () => ({
  recordAuditEvent: vi.fn(async () => undefined)
}));

const createPlatform = (): App.Platform =>
  ({
    env: {
      DB: {} as D1Database,
      ADMIN_PASSWORD_HASH: 'pbkdf2$1000$AQIDBA==$BQYHCA==',
      SESSION_SECRET: 'test-session-secret-with-minimum-length-123456',
      ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      APP_ENV: 'production'
    },
    context: {
      waitUntil() {
        // no-op
      }
    } as unknown as ExecutionContext
  }) as App.Platform;

const createEvent = (request: Request) =>
  ({
    request,
    platform: createPlatform(),
    locals: { requestId: 'req-test' },
    url: new URL(request.url)
  }) as Parameters<typeof POST>[0];

describe('/api/auth/login POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 for wrong password', async () => {
    vi.mocked(getThrottleRemainingMs).mockResolvedValueOnce(0);
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);
    vi.mocked(registerFailedLogin).mockResolvedValueOnce({
      failedCount: 1,
      blockedUntil: null,
      remainingMs: 0
    });

    const response = await POST(
      createEvent(
        new Request('https://example.com/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'wrong' })
        })
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid password' });
    expect(createSessionCookie).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed json body', async () => {
    const response = await POST(
      createEvent(
        new Request('https://example.com/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{'
        })
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 503 when auth backend throws', async () => {
    vi.mocked(getThrottleRemainingMs).mockResolvedValueOnce(0);
    vi.mocked(verifyPassword).mockRejectedValueOnce(new Error('boom'));

    const response = await POST(
      createEvent(
        new Request('https://example.com/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'any' })
        })
      )
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication service unavailable' });
  });

  it('sets both session and csrf cookies on success', async () => {
    vi.mocked(getThrottleRemainingMs).mockResolvedValueOnce(0);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);

    const response = await POST(
      createEvent(
        new Request('https://example.com/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'correct' })
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(createSessionCookie).toHaveBeenCalledTimes(1);
    expect(createCsrfToken).toHaveBeenCalledTimes(1);
    expect(buildCsrfCookie).toHaveBeenCalledTimes(1);
    expect(clearLoginAttempts).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(getAuthIdentifier).toHaveBeenCalledTimes(1);
  });
});
