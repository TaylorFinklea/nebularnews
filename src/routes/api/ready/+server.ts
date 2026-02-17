import { apiError, apiOk } from '$lib/server/api';
import { assertSchemaVersion, EXPECTED_SCHEMA_VERSION } from '$lib/server/migrations';

export const GET = async (event) => {
  try {
    const version = await assertSchemaVersion(event.platform.env.DB);
    await event.platform.env.DB.prepare('SELECT 1 as ok').first();
    return apiOk(event, {
      status: 'ready',
      schema_version: version,
      expected_schema_version: EXPECTED_SCHEMA_VERSION,
      timestamp: Date.now()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Service is not ready';
    return apiError(event, 503, 'schema_not_ready', message);
  }
};

