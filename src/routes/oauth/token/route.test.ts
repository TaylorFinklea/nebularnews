import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeAuthorizationCodeGrantMock = vi.hoisted(() => vi.fn());
const exchangeRefreshTokenGrantMock = vi.hoisted(() => vi.fn());
const recordAuditEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$lib/server/oauth/tokens', () => ({
  exchangeAuthorizationCodeGrant: exchangeAuthorizationCodeGrantMock,
  exchangeRefreshTokenGrant: exchangeRefreshTokenGrantMock
}));

vi.mock('$lib/server/audit', () => ({
  recordAuditEvent: recordAuditEventMock
}));

import { POST } from './+server';

const createPlatform = (): App.Platform =>
  ({
    env: {
      DB: {} as D1Database,
      MCP_PUBLIC_ENABLED: 'true',
      MCP_PUBLIC_BASE_URL: 'https://mcp.news.finklea.dev',
      MCP_PUBLIC_ALLOWED_ORIGINS: 'https://chatgpt.com'
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
    locals: {
      requestId: 'req-1',
      user: null
    }
  }) as Parameters<typeof POST>[0];

describe('/oauth/token POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeAuthorizationCodeGrantMock.mockResolvedValue({
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-1',
      scope: 'mcp:read',
      resource: 'https://mcp.news.finklea.dev/mcp'
    });
  });

  it('accepts JSON token requests', async () => {
    const response = await POST(
      createEvent(
        new Request('https://mcp.news.finklea.dev/oauth/token', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://chatgpt.com'
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code: 'raw-code',
            code_verifier: 'verifier'
          })
        })
      )
    );

    expect(response.status).toBe(200);
    expect(exchangeAuthorizationCodeGrantMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(URLSearchParams)
    );
    const form = exchangeAuthorizationCodeGrantMock.mock.calls[0][2];
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('raw-code');
    expect(form.get('code_verifier')).toBe('verifier');
  });

  it('audits token failures', async () => {
    exchangeAuthorizationCodeGrantMock.mockRejectedValueOnce({
      status: 400,
      body: {
        message: 'OAuth PKCE verifier is invalid.'
      }
    });

    const response = await POST(
      createEvent(
        new Request('https://mcp.news.finklea.dev/oauth/token', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin: 'https://chatgpt.com'
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: 'client-123',
            code: 'raw-code',
            code_verifier: 'bad'
          }).toString()
        })
      )
    );

    expect(response.status).toBe(400);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'oauth.token.failed',
        target: 'client-123'
      })
    );
  });
});
