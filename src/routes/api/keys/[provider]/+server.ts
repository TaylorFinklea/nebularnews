import { json } from '@sveltejs/kit';
import { deleteProviderKey } from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const DELETE = async ({ params, platform, locals }) => {
  const provider = params.provider;
  if (!['openai', 'anthropic'].includes(provider)) return json({ error: 'Invalid provider' }, { status: 400 });
  await deleteProviderKey(platform.env.DB, provider as 'openai' | 'anthropic');
  await recordAuditEvent(platform.env.DB, {
    actor: 'admin',
    action: 'keys.delete',
    target: provider,
    requestId: locals.requestId
  });
  return json({ ok: true });
};
