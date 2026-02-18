import { apiOk } from '$lib/server/api';
import { dbAll } from '$lib/server/db';
import { EXPECTED_SCHEMA_VERSION, getSchemaVersion } from '$lib/server/migrations';
import { getOpsSummary } from '$lib/server/ops';
import { inspectRuntimeConfig } from '$lib/server/runtime-config';

const REQUIRED_SETTINGS = [
  'ingest_provider',
  'ingest_model',
  'chat_provider',
  'chat_model',
  'initial_feed_lookback_days',
  'retention_days',
  'retention_mode'
];

export const GET = async (event) => {
  const schemaVersion = await getSchemaVersion(event.platform.env.DB);
  const runtime = inspectRuntimeConfig(event.platform.env);
  const ops = await getOpsSummary(event.platform.env.DB);
  const settingRows = await dbAll<{ key: string }>(
    event.platform.env.DB,
    `SELECT key
     FROM settings
     WHERE key IN (${REQUIRED_SETTINGS.map(() => '?').join(', ')})`,
    REQUIRED_SETTINGS
  );
  const existing = new Set(settingRows.map((row) => row.key));
  const missingSettings = REQUIRED_SETTINGS.filter((key) => !existing.has(key));

  return apiOk(event, {
    status: schemaVersion >= EXPECTED_SCHEMA_VERSION && runtime.ok ? 'ready' : 'attention_required',
    schema: {
      current_version: schemaVersion,
      expected_version: EXPECTED_SCHEMA_VERSION,
      ok: schemaVersion >= EXPECTED_SCHEMA_VERSION
    },
    runtime: {
      stage: runtime.stage,
      ok: runtime.ok,
      secret_checks: runtime.secretChecks,
      errors: runtime.errors,
      warnings: runtime.warnings
    },
    settings: {
      required_keys: REQUIRED_SETTINGS,
      missing_keys: missingSettings,
      ok: missingSettings.length === 0
    },
    ops
  });
};

