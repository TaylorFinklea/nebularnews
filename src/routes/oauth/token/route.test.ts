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

import { OPTIONS, POST } from './+server';

const createEvent = (request: Request) =>
  ({
    request,
    locals: {
      db: {} as any,
      requestId: 'req-1',
      user: null,
      env: {
        MCP_PUBLIC_ENABLED: 'true',
        MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
        MCP_PUBLIC_ALLOWED_ORIGINS: 'https://chatgpt.com'
      }
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
      resource: 'https://mcp.example.com/mcp'
    });
  });

  it('accepts JSON token requests', async () => {
    const response = await POST(
      createEvent(
        new Request('https://mcp.example.com/oauth/token', {
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
      'mcp',
      expect.any(URLSearchParams)
    );
    const form = exchangeAuthorizationCodeGrantMock.mock.calls[0][3];
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
        new Request('https://mcp.example.com/oauth/token', {
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

  it('answers preflight requests with permissive OAuth CORS headers', async () => {
    const response = await OPTIONS(
      createEvent(
        new Request('https://mcp.example.com/oauth/token', {
          method: 'OPTIONS',
          headers: {
            origin: 'https://chatgpt.com',
            'access-control-request-headers': 'content-type, x-requested-with'
          }
        })
      )
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type, x-requested-with');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
