import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolvePublicMcpAuthMock = vi.fn();
const resolveInternalMcpAuthMock = vi.fn();

vi.mock('$lib/server/mcp/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/mcp/auth')>();
  return {
    ...actual,
    resolvePublicMcpAuth: resolvePublicMcpAuthMock,
    resolveInternalMcpAuth: resolveInternalMcpAuthMock
  };
});

const createPlatform = (overrides?: Partial<App.Platform['env']>): App.Platform =>
  ({
    env: {
      DB: {} as D1Database,
      ADMIN_PASSWORD_HASH: 'hash',
      SESSION_SECRET: 'secret',
      ENCRYPTION_KEY: 'enc',
      MCP_BEARER_TOKEN: 'mcp-token',
      MCP_SERVER_NAME: 'Nebular News MCP',
      MCP_SERVER_VERSION: '0.1.0',
      MCP_PUBLIC_ENABLED: 'true',
      MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
      MCP_PUBLIC_ALLOWED_ORIGINS: 'https://chatgpt.com',
      ...overrides
    },
    context: {
      waitUntil() {
        // no-op
      }
    } as unknown as ExecutionContext
  }) as App.Platform;

const parseMcpPayload = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const body = await response.text();
  const dataLines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);

  for (const dataLine of dataLines) {
    try {
      return JSON.parse(dataLine);
    } catch {
      // Keep trying.
    }
  }

  throw new Error(`Unable to parse MCP response payload: ${body}`);
};

describe('/mcp public audience behavior', () => {
  beforeEach(() => {
    resolvePublicMcpAuthMock.mockReset();
    resolveInternalMcpAuthMock.mockReset();
  });

  it('returns WWW-Authenticate metadata on public GET without auth', async () => {
    resolvePublicMcpAuthMock.mockResolvedValue({ ok: false, reason: 'missing_token' });
    const { GET } = await import('./+server');

    const response = await GET({
      request: new Request('https://mcp.example.com/mcp'),
      platform: createPlatform()
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
    );
  });

  it('exposes only read-only public tools when OAuth auth succeeds', async () => {
    resolvePublicMcpAuthMock.mockResolvedValue({
      ok: true,
      method: 'oauth',
      clientId: 'client-123',
      userId: 'admin',
      scope: 'mcp:read'
    });
    const { POST } = await import('./+server');

    const response = await POST({
      request: new Request('https://mcp.example.com/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          origin: 'https://chatgpt.com'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(200);
    const payload = await parseMcpPayload(response);
    const names = (payload.result?.tools ?? []).map((tool: { name: string }) => tool.name);
    expect(names).toEqual(['search', 'fetch', 'retrieve_context_bundle']);
  });
});
