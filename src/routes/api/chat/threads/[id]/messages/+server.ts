import { json } from '@sveltejs/kit';
import { runThreadMessage } from '$lib/server/chat';

export const POST = async ({ params, request, platform }) => {
  const body = await request.json();
  const message = body?.message?.trim();
  if (!message) return json({ error: 'Missing message' }, { status: 400 });

  try {
    const result = await runThreadMessage(platform.env.DB, platform.env, params.id, message);
    return json({ ok: true, response: result.content, sources: result.sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat request failed';
    return json({ error: message }, { status: 500 });
  }
};
