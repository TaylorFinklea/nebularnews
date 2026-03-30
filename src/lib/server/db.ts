import { Pool, neonConfig } from '@neondatabase/serverless';

// Hyperdrive provides a local TCP proxy — disable WebSocket mode
neonConfig.webSocketConstructor = undefined as any;
neonConfig.useSecureWebSocket = false;

export type Db = Pool;

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
  return new Pool({ connectionString });
}

export async function dbGet<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query(pgify(sql), params);
  return (result.rows[0] as T) ?? null;
}

export async function dbAll<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(pgify(sql), params);
  return result.rows as T[];
}

export async function dbRun(db: Db, sql: string, params: unknown[] = []) {
  const result = await db.query(pgify(sql), params);
  return { meta: { changes: result.rowCount ?? 0 } };
}

export async function dbBatch(db: Db, statements: { sql: string; params?: unknown[] }[]) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const s of statements) {
      results.push(await client.query(pgify(s.sql), s.params ?? []));
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function getAffectedRows(result: unknown) {
  const rowInfo = result as { meta?: { changes?: number }; rowCount?: number; count?: number; changes?: number } | null;
  return Number(rowInfo?.meta?.changes ?? rowInfo?.rowCount ?? rowInfo?.count ?? rowInfo?.changes ?? 0);
}
