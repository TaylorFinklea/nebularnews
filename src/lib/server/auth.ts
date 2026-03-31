import { error } from '@sveltejs/kit';
import { serialize } from 'cookie';
import { nanoid } from 'nanoid';
import { hmacSign, hmacVerify, pbkdf2Verify } from './crypto';
import { getCookieValue } from './cookies';
import type { Env } from './env';
import { dbGet, dbRun, now, type Db } from './db';

export const SESSION_COOKIE = 'nn_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export type AuthUser = { id: string; role: 'admin' | 'member' };

export async function verifyPassword(password: string, hash: string) {
  return pbkdf2Verify(password, hash);
}

export async function createSessionValue(secret: string, userId = 'admin') {
  const payload = {
    userId,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = toBase64(textEncoder.encode(payloadStr));
  const signature = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export async function createSessionCookie(secret: string, userId = 'admin', secure = true) {
  const value = await createSessionValue(secret, userId);
  return serialize(SESSION_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000
  });
}

export function clearSessionCookie(secure = true) {
  return serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  });
}

export async function getSessionFromRequest(request: Request, secret: string): Promise<AuthUser | null> {
  try {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return null;
    const value = getCookieValue(cookieHeader, SESSION_COOKIE);
    if (!value) return null;
    const [payloadB64, signature] = value.split('.');
    if (!payloadB64 || !signature) return null;
    const valid = await hmacVerify(payloadB64, signature, secret);
    if (!valid) return null;
    const payload = JSON.parse(textDecoder.decode(fromBase64(payloadB64))) as {
      userId: string;
      iat: number;
      exp: number;
    };
    if (!payload?.userId || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return { id: payload.userId, role: payload.userId === 'admin' ? 'admin' : 'member' };
  } catch {
    return null;
  }
}

// --- User resolution ---

export async function getUserById(db: Db, userId: string): Promise<AuthUser | null> {
  const row = await dbGet<{ id: string; role: string }>(
    db,
    'SELECT id, role FROM users WHERE id = ?',
    [userId]
  );
  if (!row) return null;
  return { id: row.id, role: row.role as 'admin' | 'member' };
}

export async function getOrCreateLocalUser(
  db: Db,
  params: { externalId: string; email: string; authProvider: string }
): Promise<AuthUser> {
  // Check if user already exists by external ID
  const existing = await dbGet<{ id: string; role: string }>(
    db,
    'SELECT id, role FROM users WHERE external_id = ?',
    [params.externalId]
  );
  if (existing) {
    await dbRun(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [now(), existing.id]);
    return { id: existing.id, role: existing.role as 'admin' | 'member' };
  }

  // Check by email (in case user was pre-created)
  const byEmail = await dbGet<{ id: string; role: string }>(
    db,
    'SELECT id, role FROM users WHERE email = ?',
    [params.email]
  );
  if (byEmail) {
    await dbRun(
      db,
      'UPDATE users SET external_id = ?, auth_provider = ?, last_login_at = ?, updated_at = ? WHERE id = ?',
      [params.externalId, params.authProvider, now(), now(), byEmail.id]
    );
    return { id: byEmail.id, role: byEmail.role as 'admin' | 'member' };
  }

  // Create new user
  const id = nanoid();
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO users (id, email, display_name, auth_provider, external_id, role, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, 'member', ?, ?, ?)`,
    [id, params.email, params.email.split('@')[0], params.authProvider, params.externalId, timestamp, timestamp, timestamp]
  );
  return { id, role: 'member' };
}

// --- Supabase JWT validation ---

export async function getSupabaseSessionFromRequest(
  request: Request,
  db: Db,
  env: Env
): Promise<AuthUser | null> {
  const jwtSecret = env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) return null;

  // Check for Supabase access token in cookie or Authorization header
  const cookieHeader = request.headers.get('cookie');
  const sbToken = cookieHeader ? getCookieValue(cookieHeader, 'sb-access-token') : null;
  const authHeader = request.headers.get('authorization')?.trim() ?? '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
  const rawToken = sbToken || bearerToken;
  if (!rawToken) return null;

  try {
    const claims = await verifySupabaseJwt(rawToken, jwtSecret);
    if (!claims?.sub || !claims?.email) return null;
    return getOrCreateLocalUser(db, {
      externalId: claims.sub,
      email: claims.email,
      authProvider: 'supabase'
    });
  } catch {
    return null;
  }
}

async function verifySupabaseJwt(
  token: string,
  secret: string
): Promise<{ sub: string; email: string; exp: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Decode signature from base64url
  const signatureBytes = fromBase64Url(signatureB64);

  // Verify
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, textEncoder.encode(signingInput));
  if (!valid) return null;

  // Decode payload
  const payload = JSON.parse(textDecoder.decode(fromBase64Url(payloadB64)));
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;

  return {
    sub: String(payload.sub ?? ''),
    email: String(payload.email ?? ''),
    exp: Number(payload.exp ?? 0)
  };
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return fromBase64(padded);
}

// --- Role helpers ---

export function requireAdmin(user: AuthUser | null) {
  if (!user || user.role !== 'admin') {
    throw error(403, 'Admin access required.');
  }
}
