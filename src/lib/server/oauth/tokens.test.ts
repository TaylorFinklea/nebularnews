import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyPkceS256Mock = vi.fn();
const getOAuthClientMock = vi.fn();
const getAuthorizationCodeByRawCodeMock = vi.fn();
const markAuthorizationCodeUsedMock = vi.fn();
const issueTokenPairMock = vi.fn();
const getRefreshTokenByRawTokenMock = vi.fn();
const revokeRefreshTokenMock = vi.fn();
const getAccessTokenByRawTokenMock = vi.fn();
const touchAccessTokenMock = vi.fn();

vi.mock('./crypto', () => ({
  verifyPkceS256: verifyPkceS256Mock
}));

vi.mock('./storage', () => ({
  OAUTH_ACCESS_TOKEN_TTL_MS: 60 * 60 * 1000,
  OAUTH_SCOPE_READ: 'mcp:read',
  getOAuthClient: getOAuthClientMock,
  getAuthorizationCodeByRawCode: getAuthorizationCodeByRawCodeMock,
  markAuthorizationCodeUsed: markAuthorizationCodeUsedMock,
  issueTokenPair: issueTokenPairMock,
  getRefreshTokenByRawToken: getRefreshTokenByRawTokenMock,
  revokeRefreshToken: revokeRefreshTokenMock,
  getAccessTokenByRawToken: getAccessTokenByRawTokenMock,
  touchAccessToken: touchAccessTokenMock
}));

const env = {
  MCP_PUBLIC_ENABLED: 'true',
  MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
  MOBILE_PUBLIC_ENABLED: 'true',
  MOBILE_PUBLIC_BASE_URL: 'https://api.example.com'
} as App.Platform['env'];

describe('oauth token helpers', () => {
  beforeEach(() => {
    verifyPkceS256Mock.mockReset();
    getOAuthClientMock.mockReset();
    getAuthorizationCodeByRawCodeMock.mockReset();
    markAuthorizationCodeUsedMock.mockReset();
    issueTokenPairMock.mockReset();
    getRefreshTokenByRawTokenMock.mockReset();
    revokeRefreshTokenMock.mockReset();
    getAccessTokenByRawTokenMock.mockReset();
    touchAccessTokenMock.mockReset();

    getOAuthClientMock.mockResolvedValue({
      clientId: 'client-123',
      redirectUris: ['https://chat.example.com/callback']
    });
    verifyPkceS256Mock.mockResolvedValue(true);
    markAuthorizationCodeUsedMock.mockResolvedValue(true);
    issueTokenPairMock.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1'
    });
  });

  it('exchanges a valid authorization code', async () => {
    const { exchangeAuthorizationCodeGrant } = await import('./tokens');
    getAuthorizationCodeByRawCodeMock.mockResolvedValue({
      id: 'code-row',
      client_id: 'client-123',
      user_id: 'admin',
      redirect_uri: 'https://chat.example.com/callback',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      expires_at: Date.now() + 60_000,
      used_at: null
    });

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'raw-code',
      client_id: 'client-123',
      redirect_uri: 'https://chat.example.com/callback',
      resource: 'https://mcp.example.com/mcp',
      code_verifier: 'verifier'
    });
    const result = await exchangeAuthorizationCodeGrant({} as D1Database, env, 'mcp', form);

    expect(result.access_token).toBe('access-1');
    expect(result.refresh_token).toBe('refresh-1');
    expect(markAuthorizationCodeUsedMock).toHaveBeenCalledWith(expect.anything(), 'code-row');
  });

  it('accepts a code exchange without redirect_uri and resource when bound on the code', async () => {
    const { exchangeAuthorizationCodeGrant } = await import('./tokens');
    getAuthorizationCodeByRawCodeMock.mockResolvedValue({
      id: 'code-row',
      client_id: 'client-123',
      user_id: 'admin',
      redirect_uri: 'https://chat.example.com/callback',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      expires_at: Date.now() + 60_000,
      used_at: null
    });

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'raw-code',
      client_id: 'client-123',
      code_verifier: 'verifier'
    });
    const result = await exchangeAuthorizationCodeGrant({} as D1Database, env, 'mcp', form);

    expect(result.access_token).toBe('access-1');
    expect(result.resource).toBe('https://mcp.example.com/mcp');
    expect(markAuthorizationCodeUsedMock).toHaveBeenCalledWith(expect.anything(), 'code-row');
  });

  it('accepts a code exchange without client_id when bound on the code', async () => {
    const { exchangeAuthorizationCodeGrant } = await import('./tokens');
    getOAuthClientMock.mockResolvedValue({
      clientId: 'client-123',
      redirectUris: ['https://chat.example.com/callback']
    });
    getAuthorizationCodeByRawCodeMock.mockResolvedValue({
      id: 'code-row',
      client_id: 'client-123',
      user_id: 'admin',
      redirect_uri: 'https://chat.example.com/callback',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      expires_at: Date.now() + 60_000,
      used_at: null
    });

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'raw-code',
      code_verifier: 'verifier'
    });
    const result = await exchangeAuthorizationCodeGrant({} as D1Database, env, 'mcp', form);

    expect(result.access_token).toBe('access-1');
    expect(getOAuthClientMock).toHaveBeenCalledWith(expect.anything(), 'client-123');
  });

  it('rejects an invalid PKCE verifier', async () => {
    const { exchangeAuthorizationCodeGrant } = await import('./tokens');
    getAuthorizationCodeByRawCodeMock.mockResolvedValue({
      id: 'code-row',
      client_id: 'client-123',
      user_id: 'admin',
      redirect_uri: 'https://chat.example.com/callback',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      expires_at: Date.now() + 60_000,
      used_at: null
    });
    verifyPkceS256Mock.mockResolvedValue(false);

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'raw-code',
      client_id: 'client-123',
      redirect_uri: 'https://chat.example.com/callback',
      resource: 'https://mcp.example.com/mcp',
      code_verifier: 'bad-verifier'
    });

    await expect(exchangeAuthorizationCodeGrant({} as D1Database, env, 'mcp', form)).rejects.toMatchObject({ status: 400 });
  });

  it('rotates a refresh token', async () => {
    const { exchangeRefreshTokenGrant } = await import('./tokens');
    getRefreshTokenByRawTokenMock.mockResolvedValue({
      id: 'refresh-row',
      client_id: 'client-123',
      user_id: 'admin',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      expires_at: Date.now() + 60_000,
      revoked_at: null
    });

    const result = await exchangeRefreshTokenGrant(
      {} as D1Database,
      env,
      'mcp',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
        client_id: 'client-123',
        resource: 'https://mcp.example.com/mcp'
      })
    );

    expect(revokeRefreshTokenMock).toHaveBeenCalledWith(expect.anything(), 'refresh-row');
    expect(result.access_token).toBe('access-1');
  });

  it('rotates a refresh token without client_id when bound on the token', async () => {
    const { exchangeRefreshTokenGrant } = await import('./tokens');
    getOAuthClientMock.mockResolvedValue({
      clientId: 'client-123',
      redirectUris: ['https://chat.example.com/callback']
    });
    getRefreshTokenByRawTokenMock.mockResolvedValue({
      id: 'refresh-row',
      client_id: 'client-123',
      user_id: 'admin',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      expires_at: Date.now() + 60_000,
      revoked_at: null
    });

    const result = await exchangeRefreshTokenGrant(
      {} as D1Database,
      env,
      'mcp',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token'
      })
    );

    expect(revokeRefreshTokenMock).toHaveBeenCalledWith(expect.anything(), 'refresh-row');
    expect(result.access_token).toBe('access-1');
  });

  it('accepts a valid public access token', async () => {
    const { authenticatePublicAccessToken } = await import('./tokens');
    getAccessTokenByRawTokenMock.mockResolvedValue({
      id: 'access-row',
      client_id: 'client-123',
      user_id: 'admin',
      scope: 'mcp:read',
      resource: 'https://mcp.example.com/mcp',
      expires_at: Date.now() + 60_000,
      revoked_at: null
    });

    const token = await authenticatePublicAccessToken({} as D1Database, env, 'mcp', 'access-token');

    expect(token?.client_id).toBe('client-123');
    expect(touchAccessTokenMock).toHaveBeenCalledWith(expect.anything(), 'access-row', 'client-123');
  });
});
