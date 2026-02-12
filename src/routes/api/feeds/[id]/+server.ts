import { json } from '@sveltejs/kit';
import { dbRun } from '$lib/server/db';

export const DELETE = async ({ params, platform }) => {
  const { id } = params;
  await dbRun(platform.env.DB, 'DELETE FROM feeds WHERE id = ?', [id]);
  return json({ ok: true });
};
