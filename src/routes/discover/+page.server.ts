import { listTags } from '$lib/server/tags';

export const load = async ({ platform, locals }) => {
  const tags = await listTags(locals.db, { limit: 300 });
  return { tags };
};
