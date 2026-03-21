import { listTags } from '$lib/server/tags';

export const load = async ({ platform }) => {
  const tags = await listTags(platform.env.DB, { limit: 300 });
  return { tags };
};
