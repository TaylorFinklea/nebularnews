import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { rotateProviderKeyEncryption } from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ request, locals }) => {
  requireAdmin(locals.user);
  const body = await request.json().catch(() => ({}));
  const providerRaw = typeof body?.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const provider = providerRaw === 'openai' || providerRaw === 'anthropic' ? providerRaw : undefined;
  if (providerRaw && !provider) {
    return json({ error: 'Invalid provider' }, { status: 400 });
  }

  const rotated = await rotateProviderKeyEncryption(locals.db, locals.env, provider);
  await recordAuditEvent(locals.db, {
    actor: 'admin',
    action: 'keys.rotate',
    target: provider ?? 'all',
    requestId: locals.requestId,
    metadata: { rotated }
  });

  return json({ ok: true, rotated, provider: provider ?? null });
};
