/** Get a single row or null. */
export async function dbGet<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await db.prepare(sql).bind(...params).first<T>();
  return result ?? null;
}

/** Get all matching rows. */
export async function dbAll<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results;
}

/** Run a write statement (INSERT, UPDATE, DELETE). */
export async function dbRun(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

/** Run multiple statements in a batch (transactional). */
export async function dbBatch(
  db: D1Database,
  statements: { sql: string; params?: unknown[] }[],
): Promise<D1Result[]> {
  const prepared = statements.map((s) =>
    db.prepare(s.sql).bind(...(s.params ?? [])),
  );
  return db.batch(prepared);
}
