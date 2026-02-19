import { describe, expect, it } from 'vitest';
import { createSessionValue, getSessionFromRequest, SESSION_COOKIE } from './auth';

const makeRequest = (cookie?: string) =>
  new Request('http://localhost/test', {
    headers: cookie ? { cookie } : {}
  });

describe('getSessionFromRequest', () => {
  it('returns authenticated user for valid signed session cookie', async () => {
    const secret = 'test-session-secret-with-minimum-length-123456';
    const value = await createSessionValue(secret);
    const session = await getSessionFromRequest(makeRequest(`${SESSION_COOKIE}=${value}`), secret);
    expect(session).toEqual({ id: 'admin' });
  });

  it('returns null for malformed session cookie payload without throwing', async () => {
    const secret = 'test-session-secret-with-minimum-length-123456';
    const malformed = `${SESSION_COOKIE}=%%%.__bad_signature__`;
    await expect(getSessionFromRequest(makeRequest(malformed), secret)).resolves.toBeNull();
  });

  it('returns null for tampered signature', async () => {
    const secret = 'test-session-secret-with-minimum-length-123456';
    const value = await createSessionValue(secret);
    const [payload] = value.split('.');
    const tampered = `${payload}.invalid-signature`;
    const session = await getSessionFromRequest(makeRequest(`${SESSION_COOKIE}=${tampered}`), secret);
    expect(session).toBeNull();
  });
});
