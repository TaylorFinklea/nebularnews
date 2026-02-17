import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';

export const GET = async ({ params, platform }) => {
  const runs = await dbAll<{
    id: string;
    attempt: number;
    status: string;
    provider: string | null;
    model: string | null;
    duration_ms: number | null;
    error: string | null;
    started_at: number;
    finished_at: number | null;
  }>(
    platform.env.DB,
    `SELECT
      id,
      attempt,
      status,
      provider,
      model,
      duration_ms,
      error,
      started_at,
      finished_at
    FROM job_runs
    WHERE job_id = ?
    ORDER BY started_at DESC
    LIMIT 50`,
    [params.id]
  );
  return json({ job_id: params.id, runs });
};

