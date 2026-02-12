import { parse, serialize } from 'cookie';
import { hmacSign, hmacVerify, pbkdf2Verify } from './crypto';

export const SESSION_COOKIE = 'nn_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function verifyPassword(password: string, hash: string) {
  return pbkdf2Verify(password, hash);
}

export async function createSessionValue(secret: string) {
  const payload = {
    userId: 'admin',
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = toBase64(textEncoder.encode(payloadStr));
  const signature = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export async function createSessionCookie(secret: string, secure = true) {
  const value = await createSessionValue(secret);
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

export async function getSessionFromRequest(request: Request, secret: string) {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const cookies = parse(cookieHeader);
  const value = cookies[SESSION_COOKIE];
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
  if (payload.exp < Date.now()) return null;
  return { id: payload.userId } as const;
}
