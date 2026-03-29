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

  // Test scoring observability
  try {
    const { getScoringObservabilitySummary } = await import('$lib/server/scoring-observability');
    const summary = await getScoringObservabilitySummary(db);
    results['scoringObs'] = { ok: true };
  } catch (err) {
    results['scoringObs'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Test signal weights
  try {
    const { loadSignalWeights } = await import('$lib/server/scoring/engine');
    const weights = await loadSignalWeights(db);
    results['signalWeights'] = { ok: true };
  } catch (err) {
    results['signalWeights'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Test news brief
  try {
    const { getLatestNewsBriefEditionSummary } = await import('$lib/server/news-brief');
    const brief = await getLatestNewsBriefEditionSummary(db);
    results['newsBrief'] = { ok: true };
  } catch (err) {
    results['newsBrief'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Test API keys
  try {
    const { dbAll } = await import('$lib/server/db');
    const keys = await dbAll(db, "SELECT id, name, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", ['admin']);
    results['apiKeys'] = { ok: true, count: keys.length };
  } catch (err) {
    results['apiKeys'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Test OAuth clients
  try {
    const { dbAll } = await import('$lib/server/db');
    const clients = await dbAll(db, "SELECT client_id, client_name FROM oauth_clients WHERE user_id = ? ORDER BY created_at DESC", ['admin']);
    results['oauthClients'] = { ok: true, count: clients.length };
  } catch (err) {
    results['oauthClients'] = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return json(results);
};
