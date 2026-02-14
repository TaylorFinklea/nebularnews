import { json } from '@sveltejs/kit';
import { createTag, listTags } from '$lib/server/tags';

const normalizeColor = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
};

export const GET = async ({ url, platform }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
  const tags = await listTags(platform.env.DB, { q, limit });
  return json({ tags });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name : '';
  const color = normalizeColor(body?.color);
  const description = typeof body?.description === 'string' ? body.description.trim() || null : null;

  if (!name.trim()) {
    return json({ error: 'Tag name is required' }, { status: 400 });
  }

  const tag = await createTag(platform.env.DB, { name, color, description });
  return json({ ok: true, tag });
};
