import { json } from '@sveltejs/kit';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpErrorResponse, readJsonRpcId, resolveMcpAuth } from '$lib/server/mcp/auth';
import { createMcpHandlers } from '$lib/server/mcp/handlers';
import { createNebularMcpServer } from '$lib/server/mcp/tools';
import { logError, logInfo } from '$lib/server/log';

const DEFAULT_SERVER_NAME = 'Nebular News MCP';
const DEFAULT_SERVER_VERSION = '0.1.0';

const MCP_CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-protocol-version, mcp-session-id',
  'cache-control': 'no-store'
};

const parseAllowedOrigins = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const resolveCorsOrigin = (request: Request, env: App.Platform['env']) => {
  const allowedOrigins = parseAllowedOrigins(env.MCP_ALLOWED_ORIGINS);
  if (allowedOrigins.length === 0) return '*';
  const origin = request.headers.get('origin')?.trim() ?? '';
  if (!origin) return null;
  if (allowedOrigins.includes(origin)) return origin;
  return '__BLOCKED__';
};

const withCors = (response: Response, request: Request, env: App.Platform['env']) => {
  const resolvedOrigin = resolveCorsOrigin(request, env);
  if (resolvedOrigin === '__BLOCKED__') {
    return new Response(
      JSON.stringify({
        error: 'Origin not allowed'
      }),
      {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8'
        }
      }
    );
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(key, value);
  }
  if (resolvedOrigin) {
    headers.set('access-control-allow-origin', resolvedOrigin);
    headers.set('vary', 'origin');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const unauthorizedResponse = (request: Request, env: App.Platform['env']) =>
  withCors(
    json(
      {
        error: 'Unauthorized'
      },
      { status: 401 }
    ),
    request,
    env
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

export const OPTIONS = async ({ request, platform }) => withCors(new Response(null, { status: 204 }), request, platform.env);

export const GET = async ({ request, platform }) => {
  const startedAt = Date.now();
  const auth = await resolveMcpAuth(request, platform.env);
  if (!auth.ok) {
    logInfo('mcp.get.unauthorized', { duration_ms: Date.now() - startedAt, reason: auth.reason });
    return unauthorizedResponse(request, platform.env);
  }

  const response = withCors(
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
    }),
    request,
    platform.env
  );
  logInfo('mcp.get.ok', { duration_ms: Date.now() - startedAt, auth: auth.method });
  return response;
};

export const POST = async ({ request, platform, locals }) => {
  const startedAt = Date.now();
  const requestId = locals?.requestId ?? null;
  const auth = await resolveMcpAuth(request, platform.env);
  if (!auth.ok) {
    if (await isLikelyMcpJsonRpc(request)) {
      const id = await readJsonRpcId(request);
      logInfo('mcp.post.unauthorized', {
        request_id: requestId,
        duration_ms: Date.now() - startedAt,
        reason: auth.reason,
        jsonrpc: true
      });
      return withCors(
        mcpErrorResponse('Unauthorized', {
          id,
          code: -32001,
          status: 401
        }),
        request,
        platform.env
      );
    }
    logInfo('mcp.post.unauthorized', {
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      reason: auth.reason,
      jsonrpc: false
    });
    return unauthorizedResponse(request, platform.env);
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
    logInfo('mcp.post.ok', {
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      auth: auth.method
    });
    return withCors(response, request, platform.env);
  } catch (error) {
    const id = await readJsonRpcId(request);
    const message = error instanceof Error ? error.message : 'Internal server error';
    logError('mcp.post.error', {
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      message
    });
    return withCors(
      mcpErrorResponse(message, {
        id,
        code: -32603,
        status: 500
      }),
      request,
      platform.env
    );
  }
};
