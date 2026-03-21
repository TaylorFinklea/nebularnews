import { json } from '@sveltejs/kit';
import { enqueueArticleJob } from '$lib/server/job-queue';
import { runArticleJobImmediately } from '$lib/server/jobs';

export const POST = async ({ params, request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const types = Array.isArray(body?.types) ? body.types : ['summarize', 'score'];
  const articleId = params.id;
  const allowed = new Set(['summarize', 'score', 'key_points', 'auto_tag']);
  const filtered = types.filter((type: string) => allowed.has(type));
  if (filtered.length === 0) {
    return json({ error: 'No valid types' }, { status: 400 });
  }

  const queued: string[] = [];
  const executed: string[] = [];

  if (filtered.includes('summarize')) {
    try {
      await runArticleJobImmediately(platform.env, 'summarize', articleId);
      executed.push('summarize');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate summary';
      const status = message === 'Job is currently running' ? 409 : 500;
      return json({ error: message }, { status });
    }
  }
  if (filtered.includes('score')) {
    await enqueueArticleJob(platform.env.DB, 'score', articleId);
    queued.push('score');
  }
  if (filtered.includes('key_points')) {
    await enqueueArticleJob(platform.env.DB, 'key_points', articleId);
    queued.push('key_points');
  }
  if (filtered.includes('auto_tag')) {
    await enqueueArticleJob(platform.env.DB, 'auto_tag', articleId);
    queued.push('auto_tag');
  }

  return json({ ok: true, executed, queued });
};
