import { getJobCounts, listJobs, normalizeJobFilter } from '$lib/server/jobs-admin';

export const load = async ({ platform, url }) => {
  const status = normalizeJobFilter(url.searchParams.get('status') ?? 'pending');
  const jobs = await listJobs(platform.env.DB, { status, limit: 150 });
  const counts = await getJobCounts(platform.env.DB);
  return { jobs, counts, status };
};
