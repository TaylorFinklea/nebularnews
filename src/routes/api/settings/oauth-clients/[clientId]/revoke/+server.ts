import { json } from '@sveltejs/kit';
import { revokeClientAccess } from '$lib/server/oauth/storage';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ params, platform, locals }) => {
  const clientId = String(params.clientId ?? '').trim();
  if (!clientId) {
    return json({ error: { message: 'clientId is required.' } }, { status: 400 });
  }

  await revokeClientAccess(locals.db, clientId);
  await recordAuditEvent(locals.db, {
    actor: locals.user ? 'admin' : 'system',
    action: 'oauth.client.revoked',
    target: clientId,
    requestId: locals.requestId
  });

  return json({ ok: true });
};
