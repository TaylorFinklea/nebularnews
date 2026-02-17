import { parse, serialize } from 'cookie';
import type { RequestEvent } from '@sveltejs/kit';

export const CSRF_COOKIE = 'nn_csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_EXEMPT_PATHS = new Set(['/api/auth/login', '/api/health', '/api/ready']);
const SECURITY_HEADERS = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  // Keep CSP permissive enough for current inline theme script + Google Fonts usage.
  'content-security-policy':
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
} as const;

const randomPart = () => Math.random().toString(36).slice(2, 18);
export const createCsrfToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${randomPart()}`;
};

const constantTimeEquals = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const buildCsrfCookie = (token: string, secure = true) =>
  serialize(CSRF_COOKIE, token, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14
  });

export const clearCsrfCookie = (secure = true) =>
  serialize(CSRF_COOKIE, '', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });

export const readCsrfCookieFromRequest = (request: Request) => {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const cookies = parse(cookieHeader);
  const token = cookies[CSRF_COOKIE];
  return token?.trim() || null;
};

const isMutatingMethod = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

const sameOrigin = (request: Request) => {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin === requestUrl.origin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (!referer) {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (!fetchSite) return false;
    return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none';
  }
  try {
    return new URL(referer).origin === requestUrl.origin;
  } catch {
    return false;
  }
};

export const validateCsrf = (event: RequestEvent) => {
  const pathname = event.url.pathname;
  if (!event.locals.user) return { ok: true } as const;
  if (!pathname.startsWith('/api')) return { ok: true } as const;
  if (!isMutatingMethod(event.request.method)) return { ok: true } as const;
  if (CSRF_EXEMPT_PATHS.has(pathname)) return { ok: true } as const;

  const cookieToken = readCsrfCookieFromRequest(event.request);
  const headerToken = event.request.headers.get(CSRF_HEADER)?.trim() ?? null;
  if (!cookieToken || !headerToken || !constantTimeEquals(cookieToken, headerToken)) {
    return { ok: false, status: 403, message: 'CSRF token check failed' } as const;
  }

  if (!sameOrigin(event.request)) {
    return { ok: false, status: 403, message: 'CSRF origin check failed' } as const;
  }
  return { ok: true } as const;
};

export const applySecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
