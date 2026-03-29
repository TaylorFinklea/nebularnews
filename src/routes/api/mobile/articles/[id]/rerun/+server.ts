import { json } from '@sveltejs/kit';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { runArticleJobImmediately } from '$lib/server/jobs';

export const POST = async ({ params, request, locals }) => {
  const { user } = await requireMobileAccess(request, locals.env, locals.db, 'app:write');

  const articleId = params.id;

  try {
    await runArticleJobImmediately(locals.db, locals.env, 'summarize', articleId);
    await runArticleJobImmediately(locals.db, locals.env, 'key_points', articleId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate summary';
    const status = message === 'Job is currently running' ? 409 : 500;
    return json({ error: message }, { status });
  }

  return json({ ok: true });
};
