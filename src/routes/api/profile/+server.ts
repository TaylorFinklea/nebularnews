import { json } from '@sveltejs/kit';
import { ensurePreferenceProfile, updatePreferenceProfile } from '$lib/server/profile';

export const GET = async ({ platform }) => {
  const profile = await ensurePreferenceProfile(platform.env.DB);
  return json({ profile });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json();
  const profileText = body?.profileText?.trim();
  if (!profileText) return json({ error: 'Missing profile text' }, { status: 400 });

  const profile = await ensurePreferenceProfile(platform.env.DB);
  await updatePreferenceProfile(platform.env.DB, profile.id, profileText);
  return json({ ok: true });
};
