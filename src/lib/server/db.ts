export type Db = D1Database;

export const now = () => Date.now();

export async function dbGet<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.first<T>();
  return result ?? null;
}

export async function dbAll<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

export async function dbRun(db: Db, sql: string, params: unknown[] = []) {
  return db.prepare(sql).bind(...params).run();
}

export async function dbBatch(db: Db, statements: { sql: string; params?: unknown[] }[]) {
  const stmts = statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? [])));
  return db.batch(stmts);
}
