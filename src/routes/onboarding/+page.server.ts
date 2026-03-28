import { redirect } from '@sveltejs/kit';
import { getOnboardingCatalog } from '$lib/server/onboarding-catalog';
import { dbGet } from '$lib/server/db';

export const load = async ({ platform, locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  const row = await dbGet<{ cnt: number }>(
    locals.db,
    'SELECT COUNT(*) as cnt FROM user_feed_subscriptions WHERE user_id = ?',
    [locals.user.id]
  );
  if ((row?.cnt ?? 0) > 0) throw redirect(303, '/');

  return { catalog: getOnboardingCatalog() };
};
