import { json } from '@sveltejs/kit';
import { getOnboardingCatalog } from '$lib/server/onboarding-catalog';

export const GET = async () => {
  return json(getOnboardingCatalog());
};
