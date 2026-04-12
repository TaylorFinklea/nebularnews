import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { TOOL_DEFINITIONS, handleToolCall } from '../mcp/tools';
import { RESOURCE_DEFINITIONS, handleResourceRead } from '../mcp/resources';

export const mcpRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// MCP Streamable HTTP Transport
//
// Implements the Model Context Protocol over HTTP using JSON-RPC 2.0.
// Claude Desktop and other MCP clients POST JSON-RPC requests here.
// ---------------------------------------------------------------------------

const MCP_PROTOCOL_VERSION = '2024-11-05';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// POST /mcp — main MCP endpoint
// ---------------------------------------------------------------------------

mcpRoutes.post('/mcp', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  let body: JsonRpcRequest;
  try {
    body = await c.req.json<JsonRpcRequest>();
  } catch {
    return c.json(jsonRpcError(null, -32700, 'Parse error'), 400);
  }

  if (body.jsonrpc !== '2.0' || !body.method) {
    return c.json(jsonRpcError(body.id ?? null, -32600, 'Invalid request'), 400);
  }

  const id = body.id ?? null;
  const params = body.params ?? {};

  switch (body.method) {
    // ── Lifecycle ───────────────────────────────────────────────────────
    case 'initialize': {
      return c.json(jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: 'nebularnews',
          version: '1.0.0',
        },
      }));
    }

    case 'notifications/initialized': {
      // Client acknowledges initialization — no response needed for notifications.
      return c.json(jsonRpcResult(id, {}));
    }

    case 'ping': {
      return c.json(jsonRpcResult(id, {}));
    }

    // ── Tools ───────────────────────────────────────────────────────────
    case 'tools/list': {
      return c.json(jsonRpcResult(id, { tools: TOOL_DEFINITIONS }));
    }

    case 'tools/call': {
      const toolName = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

      if (!toolName) {
        return c.json(jsonRpcError(id, -32602, 'Missing tool name'));
      }

      try {
        const result = await handleToolCall(toolName, toolArgs, {
          db,
          userId,
          req: c.req.raw,
          env: c.env,
        });
        return c.json(jsonRpcResult(id, result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tool execution failed';
        return c.json(jsonRpcResult(id, {
          content: [{ type: 'text', text: `Error: ${msg}` }],
          isError: true,
        }));
      }
    }

    // ── Resources ───────────────────────────────────────────────────────
    case 'resources/list': {
      return c.json(jsonRpcResult(id, { resources: RESOURCE_DEFINITIONS }));
    }

    case 'resources/read': {
      const uri = params.uri as string;
      if (!uri) {
        return c.json(jsonRpcError(id, -32602, 'Missing resource URI'));
      }

      try {
        const result = await handleResourceRead(uri, { db, userId });
        return c.json(jsonRpcResult(id, result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Resource read failed';
        return c.json(jsonRpcError(id, -32603, msg));
      }
    }

    // ── Unknown ─────────────────────────────────────────────────────────
    default: {
      return c.json(jsonRpcError(id, -32601, `Method not found: ${body.method}`));
    }
  }
});

// ---------------------------------------------------------------------------
// GET /mcp — server info (for discovery)
// ---------------------------------------------------------------------------

mcpRoutes.get('/mcp', async (c) => {
  return c.json({
    name: 'nebularnews',
    version: '1.0.0',
    protocolVersion: MCP_PROTOCOL_VERSION,
    description: 'NebularNews MCP Server — search articles, get briefs, ask about your news',
  });
});
