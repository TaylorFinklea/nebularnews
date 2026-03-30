import postgres from 'postgres';

export type Db = postgres.Sql;

export const now = () => Date.now();

/** Convert SQLite ? placeholders to Postgres $1, $2, ... */
function pgify(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Postgres OID for BIGINT (int8) — parse as JS number instead of string
const BIGINT_OID = 20;

export function createDb(connectionString: string | undefined): Db {
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL is not configured');
  }
  return postgres(connectionString, {
    max: 5,
    fetch_types: false,
    prepare: true,
    types: {
      [BIGINT_OID]: {
        to: BIGINT_OID,
        from: [BIGINT_OID],
        serialize: (x: unknown) => String(x),
        parse: (x: string) => {
          const n = Number(x);
          return Number.isSafeInteger(n) ? n : x;
        }
      }
    }
  });
}

export async function dbGet<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await db.unsafe(pgify(sql), params as (string | number | null | boolean)[]);
  return (rows[0] as T) ?? null;
}

export async function dbAll<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const rows = await db.unsafe(pgify(sql), params as (string | number | null | boolean)[]);
  return rows as unknown as T[];
}

export async function dbRun(db: Db, sql: string, params: unknown[] = []) {
  const result = await db.unsafe(pgify(sql), params as (string | number | null | boolean)[]);
  return { meta: { changes: result.count } };
}

export async function dbBatch(db: Db, statements: { sql: string; params?: unknown[] }[]) {
  return db.begin(async (tx) => {
    const results = [];
    for (const s of statements) {
      results.push(await tx.unsafe(pgify(s.sql), (s.params ?? []) as (string | number | null | boolean)[]));
    }
    return results;
  });
}

export function getAffectedRows(result: unknown) {
  const rowInfo = result as { meta?: { changes?: number }; count?: number; changes?: number } | null;
  return Number(rowInfo?.meta?.changes ?? rowInfo?.count ?? rowInfo?.changes ?? 0);
}
