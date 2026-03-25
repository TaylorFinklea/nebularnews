import { describe, expect, it, vi } from 'vitest';

const requireMobileAccessMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/mobile/auth', () => ({
  requireMobileAccess: requireMobileAccessMock
}));

import { GET } from './+server';

const createEvent = () =>
  ({
    request: new Request('https://api.example.com/api/mobile/session', {
      headers: {
        authorization: 'Bearer access-token'
      }
    }),
    platform: {
      env: {
        DB: {} as D1Database,
        MOBILE_PUBLIC_BASE_URL: 'https://api.example.com',
        MOBILE_PUBLIC_ENABLED: 'true'
      }
    } as App.Platform
  }) as Parameters<typeof GET>[0];

describe('/api/mobile/session GET', () => {
  it('returns the authenticated mobile session and server metadata', async () => {
    requireMobileAccessMock.mockResolvedValueOnce({
      token: {
        client_id: 'nebular-news-ios',
        user_id: 'admin',
        scope: 'app:read app:write'
      },
      user: { id: 'admin', role: 'admin' }
    });

    const response = await GET(createEvent());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(requireMobileAccessMock).toHaveBeenCalledWith(expect.any(Request), expect.anything(), expect.anything(), 'app:read');
    expect(payload).toEqual({
      session: {
        authenticated: true,
        clientId: 'nebular-news-ios',
        userId: 'admin',
        role: 'admin',
        scope: 'app:read app:write',
        scopes: ['app:read', 'app:write']
      },
      server: {
        origin: 'https://api.example.com',
        resource: 'https://api.example.com/api/mobile'
      },
      features: {
        dashboard: true,
        newsBrief: true,
        reactions: true,
        tags: true
      }
    });
  });
});
