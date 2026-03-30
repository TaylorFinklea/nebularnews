import { Client } from '@neondatabase/serverless';

export type Db = Client;

export const now = () => Date.now();

/** Convert SQLite ? placeholders to Postgres $1, $2, ... */
function pgify(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function createDb(connectionString: string | undefined): Db {
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL is not configured');
  }
  return new Client(connectionString);
}

async function ensureConnected(db: Db) {
  if (!(db as any)._connected) {
    await db.connect();
    (db as any)._connected = true;
  }
}

export async function dbGet<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  await ensureConnected(db);
  const result = await db.query(pgify(sql), params);
  return (result.rows[0] as T) ?? null;
}

export async function dbAll<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureConnected(db);
  const result = await db.query(pgify(sql), params);
  return result.rows as T[];
}

export async function dbRun(db: Db, sql: string, params: unknown[] = []) {
  await ensureConnected(db);
  const result = await db.query(pgify(sql), params);
  return { meta: { changes: result.rowCount ?? 0 } };
}

export async function dbBatch(db: Db, statements: { sql: string; params?: unknown[] }[]) {
  await ensureConnected(db);
  await db.query('BEGIN');
  try {
    const results = [];
    for (const s of statements) {
      results.push(await db.query(pgify(s.sql), s.params ?? []));
    }
    await db.query('COMMIT');
    return results;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

export function getAffectedRows(result: unknown) {
  const rowInfo = result as { meta?: { changes?: number }; rowCount?: number; count?: number; changes?: number } | null;
  return Number(rowInfo?.meta?.changes ?? rowInfo?.rowCount ?? rowInfo?.count ?? rowInfo?.changes ?? 0);
}
