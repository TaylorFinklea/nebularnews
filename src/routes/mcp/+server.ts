import { json } from '@sveltejs/kit';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpErrorResponse, readJsonRpcId, resolveMcpAuth } from '$lib/server/mcp/auth';
import { createMcpHandlers } from '$lib/server/mcp/handlers';
import { createNebularMcpServer } from '$lib/server/mcp/tools';

const DEFAULT_SERVER_NAME = 'Nebular News MCP';
const DEFAULT_SERVER_VERSION = '0.1.0';

const MCP_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-protocol-version, mcp-session-id',
  'cache-control': 'no-store'
};

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const unauthorizedJson = () =>
  withCors(
    json(
      {
        error: 'Unauthorized'
      },
      {
        status: 401
      }
    )
  );

const isLikelyMcpJsonRpc = async (request: Request) => {
  try {
    const payload = await request.clone().json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const jsonrpc = (payload as { jsonrpc?: unknown }).jsonrpc;
    const method = (payload as { method?: unknown }).method;
    return jsonrpc === '2.0' && typeof method === 'string';
  } catch {
    return false;
  }
};

export const OPTIONS = async () => withCors(new Response(null, { status: 204 }));

export const GET = async ({ request, platform }) => {
  const auth = await resolveMcpAuth(request, platform.env);
  if (!auth.ok) return unauthorizedJson();

  return withCors(
    json({
      ok: true,
      endpoint: '/mcp',
      protocol: 'streamable-http',
      name: platform.env.MCP_SERVER_NAME ?? DEFAULT_SERVER_NAME,
      version: platform.env.MCP_SERVER_VERSION ?? DEFAULT_SERVER_VERSION,
      auth: auth.method,
      hints: {
        transport: 'POST /mcp',
        required_header: 'Authorization: Bearer <token>'
      }
    })
  );
};

export const POST = async ({ request, platform }) => {
  const auth = await resolveMcpAuth(request, platform.env);
  if (!auth.ok) {
    if (await isLikelyMcpJsonRpc(request)) {
      const id = await readJsonRpcId(request);
      return withCors(
        mcpErrorResponse('Unauthorized', {
          id,
          code: -32001,
          status: 401
        })
      );
    }
    return unauthorizedJson();
  }

  const handlers = createMcpHandlers({
    db: platform.env.DB,
    env: platform.env,
    context: platform.context
  });
  const server = createNebularMcpServer({
    name: platform.env.MCP_SERVER_NAME ?? DEFAULT_SERVER_NAME,
    version: platform.env.MCP_SERVER_VERSION ?? DEFAULT_SERVER_VERSION,
    handlers
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response);
  } catch (error) {
    const id = await readJsonRpcId(request);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return withCors(
      mcpErrorResponse(message, {
        id,
        code: -32603,
        status: 500
      })
    );
  }
};

