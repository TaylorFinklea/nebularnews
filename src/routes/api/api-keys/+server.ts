import { json } from '@sveltejs/kit';
import { generateApiKey, listApiKeys } from '$lib/server/api-keys';

export const GET = async ({ locals }) => {
  const keys = await listApiKeys(locals.db);
  return json({ keys });
};

export const POST = async ({ request, locals }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;

  try {
    const result = await generateApiKey(locals.db, locals.env, name);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate API key';
    return json({ error: message }, { status: 500 });
  }
};
