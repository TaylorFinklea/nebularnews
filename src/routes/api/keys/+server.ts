import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { setProviderKey } from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ request, locals }) => {
  requireAdmin(locals.user);
  const body = await request.json();
  const provider = body?.provider;
  const apiKey = body?.apiKey?.trim();
  if (!provider || !apiKey) return json({ error: 'Missing provider or apiKey' }, { status: 400 });
  if (!['openai', 'anthropic'].includes(provider)) return json({ error: 'Invalid provider' }, { status: 400 });

  await setProviderKey(locals.db, locals.env, provider, apiKey);
  await recordAuditEvent(locals.db, {
    actor: 'admin',
    action: 'keys.set',
    target: provider,
    requestId: locals.requestId
  });
  return json({ ok: true });
};
