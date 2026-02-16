import { describe, expect, it } from 'vitest';
import { GET, POST } from './+server';

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
      // keep trying
    }
  }

  throw new Error(`Unable to parse MCP response payload: ${body}`);
};

describe('/mcp route auth behavior', () => {
  it('returns 401 json on GET without auth', async () => {
    const response = await GET({
      request: new Request('http://localhost/mcp'),
      platform: createPlatform()
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns discovery payload on GET with bearer auth', async () => {
    const response = await GET({
      request: new Request('http://localhost/mcp', {
        headers: {
          authorization: 'Bearer mcp-token'
        }
      }),
      platform: createPlatform()
    } as Parameters<typeof GET>[0]);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.endpoint).toBe('/mcp');
    expect(payload.protocol).toBe('streamable-http');
  });

  it('returns MCP-formatted unauthorized error for MCP JSON-RPC requests', async () => {
    const response = await POST({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/list',
          params: {}
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.id).toBe(42);
    expect(payload.error.code).toBe(-32001);
  });

  it('serves initialize and tools/list over MCP with bearer auth', async () => {
    const initializeResponse = await POST({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer mcp-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' }
          }
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(initializeResponse.status).toBe(200);
    const initializePayload = await parseMcpPayload(initializeResponse);
    expect(initializePayload.jsonrpc).toBe('2.0');
    expect(initializePayload.id).toBe(1);
    expect(initializePayload.result?.serverInfo?.name).toBeTruthy();

    const response = await POST({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer mcp-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/list',
          params: {}
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(200);
    const payload = await parseMcpPayload(response);
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.id).toBe(100);
    const tools = payload.result?.tools ?? [];
    const names = tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('search');
    expect(names).toContain('fetch');
  });

  it('serves resources/list and resources/read over MCP with bearer auth', async () => {
    const listResponse = await POST({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer mcp-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 200,
          method: 'resources/list',
          params: {}
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(listResponse.status).toBe(200);
    const listPayload = await parseMcpPayload(listResponse);
    expect(listPayload.jsonrpc).toBe('2.0');
    expect(listPayload.id).toBe(200);
    const resources = listPayload.result?.resources ?? [];
    const uris = resources.map((resource: { uri: string }) => resource.uri);
    expect(uris).toContain('nebular://server/info');

    const readResponse = await POST({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer mcp-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 201,
          method: 'resources/read',
          params: {
            uri: 'nebular://server/info'
          }
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(readResponse.status).toBe(200);
    const readPayload = await parseMcpPayload(readResponse);
    expect(readPayload.jsonrpc).toBe('2.0');
    expect(readPayload.id).toBe(201);
    const contents = readPayload.result?.contents ?? [];
    expect(contents.length).toBeGreaterThan(0);
    expect(contents[0].uri).toBe('nebular://server/info');
    const parsedText = JSON.parse(contents[0].text);
    expect(parsedText.name).toBe('Nebular News MCP');
  });

  it('serves resources/templates/list over MCP with bearer auth', async () => {
    const response = await POST({
      request: new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer mcp-token',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 300,
          method: 'resources/templates/list',
          params: {}
        })
      }),
      platform: createPlatform()
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(200);
    const payload = await parseMcpPayload(response);
    expect(payload.jsonrpc).toBe('2.0');
    expect(payload.id).toBe(300);
    const templates = payload.result?.resourceTemplates ?? [];
    const templateUris = templates.map((entry: { uriTemplate: string }) => entry.uriTemplate);
    expect(templateUris).toContain('nebular://article/{article_id}');
  });
});
