import { json } from '@sveltejs/kit';
import { runScheduledTasks } from '$lib/server/scheduler';

const VALID_MODES = new Set(['all', 'jobs', 'poll', 'retention']);

export const GET = async ({ url, locals }) => {
  if (locals.env.APP_ENV !== 'development') {
    return json({ error: 'Dev scheduled handler is only available in development' }, { status: 403 });
  }

  const cron = url.searchParams.get('cron')?.trim() || null;
  const mode = (url.searchParams.get('mode')?.trim().toLowerCase() || 'all') as
    | 'all'
    | 'jobs'
    | 'poll'
    | 'retention';

  if (!VALID_MODES.has(mode)) {
    return json({ error: 'Invalid mode. Use all, jobs, poll, or retention.' }, { status: 400 });
  }

  const summary = await runScheduledTasks(locals.db, locals.env, {
    cron,
    runJobs: cron ? undefined : mode === 'all' || mode === 'jobs',
    runPoll: cron ? undefined : mode === 'all' || mode === 'poll',
    runRetention: cron ? undefined : mode === 'retention'
  });

  return json({
    ok: true,
    data: summary
  });
};
