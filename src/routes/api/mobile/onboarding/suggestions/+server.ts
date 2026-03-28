import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getOnboardingCatalog } from '$lib/server/onboarding-catalog';

export const GET = async ({ request, platform, locals }) => {
  await requireMobileAccess(request, platform.env, locals.db, 'app:read');
  return json(getOnboardingCatalog());
};
