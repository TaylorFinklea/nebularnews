import { json } from '@sveltejs/kit';

export const GET = async ({ locals }) => {
  const start = Date.now();
  try {
    const { dbGet } = await import('$lib/server/db');
    const row = await dbGet<{ v: number }>(locals.db, 'SELECT 1 as v');
    return json({
      ok: true,
      value: row?.v,
      ms: Date.now() - start,
      env_check: {
        SUPABASE_URL: !!locals.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: !!locals.env.SUPABASE_ANON_KEY,
        SUPABASE_JWT_SECRET: !!locals.env.SUPABASE_JWT_SECRET,
        SESSION_SECRET: !!locals.env.SESSION_SECRET,
        SUPABASE_DB_URL: !!locals.env.SUPABASE_DB_URL
      }
    });
  } catch (err) {
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 3) : undefined,
      ms: Date.now() - start
    }, { status: 500 });
  }
};
