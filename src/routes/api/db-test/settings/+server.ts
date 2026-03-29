import { json } from '@sveltejs/kit';

export const GET = async ({ locals }) => {
  const db = locals.db;
  const results: Record<string, unknown> = {};

  const queries = [
    ['settings_count', "SELECT COUNT(*) as count FROM settings"],
    ['feeds_count', "SELECT COUNT(*) as count FROM feeds"],
    ['articles_count', "SELECT COUNT(*) as count FROM articles"],
    ['users_count', "SELECT COUNT(*) as count FROM users"],
    ['schema_version', "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"],
  ];

  for (const [name, sql] of queries) {
    try {
      const { dbGet } = await import('$lib/server/db');
      const row = await dbGet(db, sql);
      results[name] = { ok: true, row };
    } catch (err) {
      results[name] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Test a settings function
  try {
    const { getDashboardQueueConfig } = await import('$lib/server/settings');
    const queueConfig = await getDashboardQueueConfig(db);
    results['dashboardQueueConfig'] = { ok: true, value: queueConfig };
  } catch (err) {
    results['dashboardQueueConfig'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Test getConfiguredModelA
  try {
    const { getConfiguredModelA } = await import('$lib/server/settings');
    const modelA = await getConfiguredModelA(db, locals.env);
    results['modelA'] = { ok: true, value: modelA };
  } catch (err) {
    results['modelA'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return json(results);
};
