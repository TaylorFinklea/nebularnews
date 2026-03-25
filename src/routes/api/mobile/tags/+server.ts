import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { listTags, createTag } from '$lib/server/tags';

export const GET = async ({ request, platform, url }) => {
  const { user } = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');
  void user;
  const q = url.searchParams.get('q') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const tags = await listTags(platform.env.DB, { q, limit });
  return json({ tags });
};

export const POST = async ({ request, platform }) => {
  const { user } = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:write');
  void user;
  const body = await request.json().catch(() => ({}));

  const name = String(body?.name ?? '').trim();
  if (!name) {
    return json({ error: 'Tag name is required.' }, { status: 400 });
  }

  const color = body?.color !== undefined && body?.color !== null ? String(body.color).trim() : undefined;
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return json({ error: 'Color must be a hex value like #FF0000.' }, { status: 400 });
  }

  const description =
    body?.description !== undefined && body?.description !== null
      ? String(body.description).trim() || undefined
      : undefined;

  const tag = await createTag(platform.env.DB, { name, color, description });
  return json({ ok: true, tag });
};
