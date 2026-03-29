import { json } from '@sveltejs/kit';
import { dbGet } from '$lib/server/db';
import { getOrCreateThreadForArticle, sendChatMessage } from '$lib/server/chat';

export const GET = async ({ params, locals }) => {
  const userId = locals.user?.id ?? 'admin';
  const articleId = params.id;
  const article = await dbGet<{ id: string }>(locals.db, 'SELECT id FROM articles WHERE id = ?', [articleId]);
  if (!article) return json({ error: 'Article not found' }, { status: 404 });

  const result = await getOrCreateThreadForArticle(locals.db, userId, articleId);
  return json(result);
};

export const POST = async ({ params, request, locals }) => {
  const userId = locals.user?.id ?? 'admin';
  const articleId = params.id;
  const article = await dbGet<{ id: string }>(locals.db, 'SELECT id FROM articles WHERE id = ?', [articleId]);
  if (!article) return json({ error: 'Article not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const content = String(body?.content ?? body?.message ?? '').trim();

  if (!content) return json({ error: 'Message content is required' }, { status: 400 });
  if (content.length > 4000) return json({ error: 'Message too long (max 4000 characters)' }, { status: 400 });

  try {
    const result = await sendChatMessage(locals.db, userId, locals.env, articleId, content);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat failed';
    return json({ error: message }, { status: 500 });
  }
};
