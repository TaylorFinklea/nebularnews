import { describe, expect, it, vi } from 'vitest';

const authenticatePublicAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/oauth/tokens', () => ({
  authenticatePublicAccessToken: authenticatePublicAccessTokenMock
}));

vi.mock('$lib/server/migrations', () => ({
  ensureSchema: vi.fn()
}));

import { requireMobileAccess } from './auth';

const env = {} as App.Platform['env'];
const db = {} as D1Database;

describe('requireMobileAccess', () => {
  it('rejects requests without a bearer token', async () => {
    await expect(requireMobileAccess(new Request('https://api.example.com/api/mobile/session'), env, db)).rejects.toMatchObject({
      status: 401,
      body: { message: 'Missing OAuth access token.' }
    });
  });

  it('rejects invalid access tokens', async () => {
    authenticatePublicAccessTokenMock.mockResolvedValueOnce(null);

    await expect(
      requireMobileAccess(
        new Request('https://api.example.com/api/mobile/session', {
          headers: { authorization: 'Bearer invalid-token' }
        }),
        env,
        db
      )
    ).rejects.toMatchObject({
      status: 401,
      body: { message: 'Invalid OAuth access token.' }
    });
  });

  it('rejects access tokens without the required scope', async () => {
    authenticatePublicAccessTokenMock.mockResolvedValueOnce({
      client_id: 'mobile-client',
      user_id: 'admin',
      scope: 'app:read'
    });

    await expect(
      requireMobileAccess(
        new Request('https://api.example.com/api/mobile/articles/article-1/reaction', {
          headers: { authorization: 'Bearer read-only-token' }
        }),
        env,
        db,
        'app:write'
      )
    ).rejects.toMatchObject({
      status: 403,
      body: { message: 'Insufficient OAuth scope.' }
    });
  });

  it('returns the authenticated token when the scope matches', async () => {
    const token = {
      client_id: 'mobile-client',
      user_id: 'admin',
      scope: 'app:read app:write'
    };
    authenticatePublicAccessTokenMock.mockResolvedValueOnce(token);

    await expect(
      requireMobileAccess(
        new Request('https://api.example.com/api/mobile/articles', {
          headers: { authorization: 'Bearer valid-token' }
        }),
        env,
        db,
        'app:write'
      )
    ).resolves.toEqual(token);
    expect(authenticatePublicAccessTokenMock).toHaveBeenCalledWith(db, env, 'mobile', 'valid-token');
  });
});
