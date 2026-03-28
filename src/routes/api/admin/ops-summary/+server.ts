import { apiOk } from '$lib/server/api';
import { requireAdmin } from '$lib/server/auth';
import { getOpsSummary } from '$lib/server/ops';

export const GET = async (event) => {
  requireAdmin(event.locals.user);
  const summary = await getOpsSummary(event.locals.db);
  return apiOk(event, summary);
};

