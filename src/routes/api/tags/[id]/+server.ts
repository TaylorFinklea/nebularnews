import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { deleteTag, getTagById, updateTag } from '$lib/server/tags';

const normalizeColor = (value: unknown) => {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : undefined;
};

export const PATCH = async ({ params, request, platform, locals }) => {
  requireAdmin(locals.user);
  const body = await request.json().catch(() => ({}));
  const existing = await getTagById(locals.db, params.id);
  if (!existing) return json({ error: 'Tag not found' }, { status: 404 });

  const color = normalizeColor(body?.color);
  if (body?.color !== undefined && color === undefined) {
    return json({ error: 'Color must be a hex value like #12abef' }, { status: 400 });
  }

  try {
    const updated = await updateTag(locals.db, params.id, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      color,
      description: typeof body?.description === 'string' ? body.description.trim() || null : undefined
    });
    return json({ ok: true, tag: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tag';
    if (message.includes('UNIQUE')) {
      return json({ error: 'Tag name or slug already exists' }, { status: 409 });
    }
    return json({ error: message }, { status: 400 });
  }
};

export const DELETE = async ({ params, platform, locals }) => {
  requireAdmin(locals.user);
  const existing = await getTagById(locals.db, params.id);
  if (!existing) return json({ error: 'Tag not found' }, { status: 404 });
  await deleteTag(locals.db, params.id);
  return json({ ok: true });
};
