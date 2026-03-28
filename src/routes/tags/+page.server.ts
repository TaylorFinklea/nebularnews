import { listTags } from '$lib/server/tags';

export const load = async ({ platform, locals, url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const tags = await listTags(locals.db, { q, limit: 300 });
  return { tags, q };
};
