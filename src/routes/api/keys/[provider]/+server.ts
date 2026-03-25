import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { deleteProviderKey } from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const DELETE = async ({ params, platform, locals }) => {
  requireAdmin(locals.user);
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
