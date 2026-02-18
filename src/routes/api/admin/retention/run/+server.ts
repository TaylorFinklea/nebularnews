import { apiOk } from '$lib/server/api';
import { runRetentionCleanup } from '$lib/server/retention';

export const POST = async (event) => {
  const stats = await runRetentionCleanup(event.platform.env);
  return apiOk(event, stats);
};

