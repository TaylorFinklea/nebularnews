import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import { createThread, type ChatScope } from '$lib/server/chat';

export const GET = async ({ platform }) => {
  const threads = await dbAll(
    platform.env.DB,
    'SELECT id, scope, article_id, title, created_at FROM chat_threads ORDER BY created_at DESC'
  );
  return json({ threads });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json();
  const scope = (body?.scope ?? 'global') as ChatScope;
  const articleId = body?.articleId ?? null;
  const title = body?.title ?? null;
  if (!['global', 'article'].includes(scope)) return json({ error: 'Invalid scope' }, { status: 400 });

  const id = await createThread(platform.env.DB, scope, articleId, title);
  return json({ id });
};
