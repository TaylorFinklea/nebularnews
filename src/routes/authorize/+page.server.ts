import { redirect } from '@sveltejs/kit';

export const load = async ({ url }) => {
  const destination = new URL('/oauth/authorize', url.origin);
  destination.search = url.search;
  throw redirect(307, destination.toString());
};
