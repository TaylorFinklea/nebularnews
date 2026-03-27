import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getOnboardingCatalog } from '$lib/server/onboarding-catalog';

export const GET = async ({ request, platform }) => {
  await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');
  return json(getOnboardingCatalog());
};
