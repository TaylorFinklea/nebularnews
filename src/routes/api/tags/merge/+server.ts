import { json } from '@sveltejs/kit';
import { mergeTags } from '$lib/server/tags';

export const POST = async ({ request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const sourceTagId = typeof body?.sourceTagId === 'string' ? body.sourceTagId.trim() : '';
  const targetTagId = typeof body?.targetTagId === 'string' ? body.targetTagId.trim() : '';
  const deleteSource = body?.deleteSource !== false;

  if (!sourceTagId || !targetTagId) {
    return json({ error: 'sourceTagId and targetTagId are required' }, { status: 400 });
  }
  if (sourceTagId === targetTagId) {
    return json({ error: 'Source and target must differ' }, { status: 400 });
  }

  try {
    const result = await mergeTags(platform.env.DB, { sourceTagId, targetTagId, deleteSource });
    return json({ ok: true, result });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Merge failed' }, { status: 400 });
  }
};
