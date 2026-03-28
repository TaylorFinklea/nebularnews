import { json } from '@sveltejs/kit';
import { ensurePreferenceProfile, updatePreferenceProfile } from '$lib/server/profile';

export const GET = async ({ platform, locals }) => {
  const profile = await ensurePreferenceProfile(locals.db);
  return json({ profile });
};

export const POST = async ({ request, platform, locals }) => {
  const body = await request.json();
  const profileText = body?.profileText?.trim();
  if (!profileText) return json({ error: 'Missing profile text' }, { status: 400 });

  const profile = await ensurePreferenceProfile(locals.db);
  await updatePreferenceProfile(locals.db, profile.id, profileText);
  return json({ ok: true });
};
