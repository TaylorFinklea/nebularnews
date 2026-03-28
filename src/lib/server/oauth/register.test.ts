import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerOAuthClientMock = vi.fn();

vi.mock('./storage', () => ({
  OAUTH_SCOPE_READ: 'mcp:read',
  registerOAuthClient: registerOAuthClientMock
}));

const createEnv = (overrides: Partial<App.Platform['env']> = {}) =>
  ({
    APP_ENV: 'development',
    MCP_PUBLIC_ENABLED: 'true',
    MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
    ...overrides
  }) as App.Platform['env'];

describe('registerDynamicClient', () => {
  beforeEach(() => {
    registerOAuthClientMock.mockReset();
    registerOAuthClientMock.mockResolvedValue({
      clientId: 'client-123',
      clientName: 'ChatGPT',
      redirectUris: ['https://chat.openai.com/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'mcp:read',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      lastUsedAt: null
    });
  });

  it('registers a valid public client', async () => {
    const { registerDynamicClient } = await import('./register');
    const result = await registerDynamicClient({} as any, createEnv(), {
      client_name: 'ChatGPT',
      redirect_uris: ['https://chat.openai.com/callback']
    });

    expect(registerOAuthClientMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientName: 'ChatGPT',
        redirectUris: ['https://chat.openai.com/callback'],
        tokenEndpointAuthMethod: 'none',
        scope: 'mcp:read'
      })
    );
    expect(result.client_id).toBe('client-123');
    expect(result.scope).toBe('mcp:read');
  });

  it('rejects unsupported token endpoint auth methods', async () => {
    const { registerDynamicClient } = await import('./register');
    await expect(
      registerDynamicClient({} as any, createEnv(), {
        client_name: 'ChatGPT',
        redirect_uris: ['https://chat.openai.com/callback'],
        token_endpoint_auth_method: 'client_secret_post'
      })
    ).rejects.toThrow('Only token_endpoint_auth_method="none" is supported');
  });

  it('rejects non-https redirect URIs in production', async () => {
    const { registerDynamicClient } = await import('./register');
    await expect(
      registerDynamicClient({} as any, createEnv({ APP_ENV: 'production' }), {
        client_name: 'Local client',
        redirect_uris: ['http://localhost:3000/callback']
      })
    ).rejects.toThrow('redirect_uris must use HTTPS in production');
  });
});
