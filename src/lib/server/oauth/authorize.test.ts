import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOAuthClientMock = vi.fn();
const hasActiveConsentMock = vi.fn();
const grantConsentMock = vi.fn();
const createAuthorizationCodeMock = vi.fn();

vi.mock('./storage', () => ({
  OAUTH_SCOPE_READ: 'mcp:read',
  getOAuthClient: getOAuthClientMock,
  hasActiveConsent: hasActiveConsentMock,
  grantConsent: grantConsentMock,
  createAuthorizationCode: createAuthorizationCodeMock
}));

const env = {
  MCP_PUBLIC_ENABLED: 'true',
  MCP_PUBLIC_BASE_URL: 'https://mcp.example.com'
} as App.Platform['env'];

describe('oauth authorize helpers', () => {
  beforeEach(() => {
    getOAuthClientMock.mockReset();
    hasActiveConsentMock.mockReset();
    grantConsentMock.mockReset();
    createAuthorizationCodeMock.mockReset();
    getOAuthClientMock.mockResolvedValue({
      clientId: 'client-123',
      clientName: 'ChatGPT',
      redirectUris: ['https://chat.openai.com/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'mcp:read',
      createdAt: 0,
      updatedAt: 0,
      lastUsedAt: null
    });
    createAuthorizationCodeMock.mockResolvedValue('auth-code');
  });

  it('parses a valid authorization request', async () => {
    const { parseAuthorizeRequest } = await import('./authorize');
    const url = new URL('https://mcp.example.com/oauth/authorize');
    url.searchParams.set('client_id', 'client-123');
    url.searchParams.set('redirect_uri', 'https://chat.openai.com/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('resource', 'https://mcp.example.com/mcp');
    url.searchParams.set('code_challenge', 'challenge');
    url.searchParams.set('code_challenge_method', 'S256');

    const result = await parseAuthorizeRequest(url, {} as any, env);

    expect(result.request.clientId).toBe('client-123');
    expect(result.request.scope).toBe('mcp:read');
  });

  it('rejects a missing resource parameter', async () => {
    const { parseAuthorizeRequest } = await import('./authorize');
    const url = new URL('https://mcp.example.com/oauth/authorize');
    url.searchParams.set('client_id', 'client-123');
    url.searchParams.set('redirect_uri', 'https://chat.openai.com/callback');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', 'challenge');
    url.searchParams.set('code_challenge_method', 'S256');

    await expect(parseAuthorizeRequest(url, {} as any, env)).rejects.toMatchObject({ status: 400 });
  });

  it('auto-approves when active consent already exists', async () => {
    const { shouldAutoApproveConsent } = await import('./authorize');
    hasActiveConsentMock.mockResolvedValue(true);

    const approved = await shouldAutoApproveConsent(
      {} as any,
      {
        clientId: 'client-123',
        redirectUri: 'https://chat.openai.com/callback',
        responseType: 'code',
        scope: 'mcp:read',
        state: 'abc',
        resource: 'https://mcp.example.com/mcp',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        prompt: null
      },
      'admin'
    );

    expect(approved).toBe(true);
  });

  it('approves consent and produces a code redirect', async () => {
    const { approveAuthorizeRequest } = await import('./authorize');

    const destination = await approveAuthorizeRequest(
      {} as any,
      env,
      {
        clientId: 'client-123',
        redirectUri: 'https://chat.openai.com/callback',
        responseType: 'code',
        scope: 'mcp:read',
        state: 'state-1',
        resource: 'https://mcp.example.com/mcp',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        prompt: null
      },
      'admin'
    );

    expect(grantConsentMock).toHaveBeenCalledWith(expect.anything(), 'client-123', 'admin', 'mcp:read');
    expect(destination).toContain('code=auth-code');
    expect(destination).toContain('state=state-1');
    expect(destination).toContain('iss=https%3A%2F%2Fmcp.example.com');
  });
});
