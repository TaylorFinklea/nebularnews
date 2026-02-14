import { listTags } from '$lib/server/tags';

export const load = async ({ platform, url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const tags = await listTags(platform.env.DB, { q, limit: 300 });
  return { tags, q };
};
