import { json } from '@sveltejs/kit';
import { enqueueArticleJob } from '$lib/server/job-queue';

export const POST = async ({ params, request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const types = Array.isArray(body?.types) ? body.types : ['summarize', 'score'];
  const articleId = params.id;
  const allowed = new Set(['summarize', 'summarize_chat', 'score', 'key_points', 'auto_tag']);
  const filtered = types.filter((type: string) => allowed.has(type));
  if (filtered.length === 0) {
    return json({ error: 'No valid types' }, { status: 400 });
  }

  if (filtered.includes('summarize')) {
    await enqueueArticleJob(platform.env.DB, 'summarize', articleId);
  }
  if (filtered.includes('summarize_chat')) {
    await enqueueArticleJob(platform.env.DB, 'summarize_chat', articleId);
  }
  if (filtered.includes('score')) {
    await enqueueArticleJob(platform.env.DB, 'score', articleId);
  }
  if (filtered.includes('key_points')) {
    await enqueueArticleJob(platform.env.DB, 'key_points', articleId);
  }
  if (filtered.includes('auto_tag')) {
    await enqueueArticleJob(platform.env.DB, 'auto_tag', articleId);
  }

  return json({ ok: true, queued: filtered });
};
