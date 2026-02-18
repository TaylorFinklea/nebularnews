import { apiOk } from '$lib/server/api';
import { getOpsSummary } from '$lib/server/ops';

export const GET = async (event) => {
  const summary = await getOpsSummary(event.platform.env.DB);
  return apiOk(event, summary);
};

