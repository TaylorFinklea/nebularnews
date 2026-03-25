import { apiOk } from '$lib/server/api';
import { requireAdmin } from '$lib/server/auth';
import { getOpsSummary } from '$lib/server/ops';

export const GET = async (event) => {
  requireAdmin(event.locals.user);
  const summary = await getOpsSummary(event.platform.env.DB);
  return apiOk(event, summary);
};

