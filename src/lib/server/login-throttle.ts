import { nanoid } from 'nanoid';
import { dbGet, dbRun, now, type Db } from './db';

const THROTTLE_START_COUNT = 5;
const THROTTLE_BASE_MS = 1000;
const THROTTLE_MAX_MS = 15 * 60 * 1000;

type AttemptRow = {
  id: string;
  failed_count: number;
  blocked_until: number | null;
};

const computeBlockMs = (failedCount: number) => {
  if (failedCount < THROTTLE_START_COUNT) return 0;
  const exponent = failedCount - THROTTLE_START_COUNT;
  const delay = THROTTLE_BASE_MS * 2 ** exponent;
  return Math.min(THROTTLE_MAX_MS, delay);
};

export const getAuthIdentifier = (request: Request) => {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;
  return 'unknown';
};

export const getThrottleRemainingMs = async (db: Db, identifier: string, at = now()) => {
  try {
    const row = await dbGet<AttemptRow>(
      db,
      'SELECT id, failed_count, blocked_until FROM auth_attempts WHERE identifier = ? LIMIT 1',
      [identifier]
    );
    if (!row?.blocked_until) return 0;
    return Math.max(0, row.blocked_until - at);
  } catch {
    return 0;
  }
};

export const registerFailedLogin = async (db: Db, identifier: string, at = now()) => {
  try {
    const existing = await dbGet<AttemptRow>(
      db,
      'SELECT id, failed_count, blocked_until FROM auth_attempts WHERE identifier = ? LIMIT 1',
      [identifier]
    );
    const nextCount = (existing?.failed_count ?? 0) + 1;
    const blockMs = computeBlockMs(nextCount);
    const blockedUntil = blockMs > 0 ? at + blockMs : null;

    if (existing) {
      await dbRun(
        db,
        `UPDATE auth_attempts
         SET failed_count = ?,
             first_failed_at = COALESCE(first_failed_at, ?),
             last_failed_at = ?,
             blocked_until = ?,
             updated_at = ?
         WHERE id = ?`,
        [nextCount, at, at, blockedUntil, at, existing.id]
      );
    } else {
      await dbRun(
        db,
        `INSERT INTO auth_attempts (
          id, identifier, failed_count, first_failed_at, last_failed_at, blocked_until, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), identifier, nextCount, at, at, blockedUntil, at]
      );
    }
    return {
      failedCount: nextCount,
      blockedUntil,
      remainingMs: blockedUntil ? Math.max(0, blockedUntil - at) : 0
    };
  } catch {
    return {
      failedCount: 0,
      blockedUntil: null,
      remainingMs: 0
    };
  }
};

export const clearLoginAttempts = async (db: Db, identifier: string) => {
  try {
    await dbRun(
      db,
      `UPDATE auth_attempts
       SET failed_count = 0,
           first_failed_at = NULL,
           last_failed_at = NULL,
           blocked_until = NULL,
           updated_at = ?
       WHERE identifier = ?`,
      [now(), identifier]
    );
  } catch {
    // Ignore when table is not initialized yet.
  }
};
