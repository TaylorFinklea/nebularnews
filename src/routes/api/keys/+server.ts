import { json } from '@sveltejs/kit';
import { setProviderKey } from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ request, platform, locals }) => {
  const body = await request.json();
  const provider = body?.provider;
  const apiKey = body?.apiKey?.trim();
  if (!provider || !apiKey) return json({ error: 'Missing provider or apiKey' }, { status: 400 });
  if (!['openai', 'anthropic'].includes(provider)) return json({ error: 'Invalid provider' }, { status: 400 });

  await setProviderKey(platform.env.DB, platform.env, provider, apiKey);
  await recordAuditEvent(platform.env.DB, {
    actor: 'admin',
    action: 'keys.set',
    target: provider,
    requestId: locals.requestId
  });
  return json({ ok: true });
};
