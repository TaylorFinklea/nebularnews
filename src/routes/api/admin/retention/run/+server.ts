import { apiOk } from '$lib/server/api';
import { requireAdmin } from '$lib/server/auth';
import { runRetentionCleanup } from '$lib/server/retention';

export const POST = async (event) => {
  requireAdmin(event.locals.user);
  const stats = await runRetentionCleanup(event.platform.env);
  return apiOk(event, stats);
};

