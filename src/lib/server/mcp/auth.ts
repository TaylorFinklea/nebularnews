import { getSessionFromRequest } from '$lib/server/auth';

export type McpAuthMethod = 'bearer' | 'session';

export type McpAuthResult =
  | { ok: true; method: McpAuthMethod }
  | { ok: false; reason: 'missing_token' | 'invalid_token' | 'unauthorized' };

export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

export function constantTimeEquals(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isMcpBearerTokenValid(provided: string | null, expected: string | null | undefined) {
  const trimmedExpected = expected?.trim();
  if (!trimmedExpected) return false;
  if (!provided) return false;
  return constantTimeEquals(provided, trimmedExpected);
}

export async function resolveMcpAuth(request: Request, env: App.Platform['env']): Promise<McpAuthResult> {
  const expectedToken = env.MCP_BEARER_TOKEN?.trim();
  const providedToken = parseBearerToken(request.headers.get('authorization'));
  const bearerValid = isMcpBearerTokenValid(providedToken, expectedToken);
  if (bearerValid) return { ok: true, method: 'bearer' };

  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (session) return { ok: true, method: 'session' };

  if (expectedToken) {
    if (providedToken) return { ok: false, reason: 'invalid_token' };
    return { ok: false, reason: 'missing_token' };
  }
  return { ok: false, reason: 'unauthorized' };
}

export async function readJsonRpcId(request: Request): Promise<string | number | null> {
  try {
    const payload = await request.clone().json();
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const id = (payload as { id?: unknown }).id;
      if (typeof id === 'string' || typeof id === 'number') return id;
      return null;
    }
    if (Array.isArray(payload) && payload.length > 0) {
      const first = payload[0];
      if (first && typeof first === 'object') {
        const id = (first as { id?: unknown }).id;
        if (typeof id === 'string' || typeof id === 'number') return id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function mcpErrorResponse(
  message: string,
  options?: {
    id?: string | number | null;
    code?: number;
    status?: number;
  }
) {
  const id = options?.id ?? null;
  const code = options?.code ?? -32000;
  const status = options?.status ?? 400;
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8'
      }
    }
  );
}

