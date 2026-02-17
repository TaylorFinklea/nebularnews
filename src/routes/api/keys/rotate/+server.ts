import { json } from '@sveltejs/kit';
import { rotateProviderKeyEncryption } from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const POST = async ({ request, platform, locals }) => {
  const body = await request.json().catch(() => ({}));
  const providerRaw = typeof body?.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const provider = providerRaw === 'openai' || providerRaw === 'anthropic' ? providerRaw : undefined;
  if (providerRaw && !provider) {
    return json({ error: 'Invalid provider' }, { status: 400 });
  }

  const rotated = await rotateProviderKeyEncryption(platform.env.DB, platform.env, provider);
  await recordAuditEvent(platform.env.DB, {
    actor: 'admin',
    action: 'keys.rotate',
    target: provider ?? 'all',
    requestId: locals.requestId,
    metadata: { rotated }
  });

  return json({ ok: true, rotated, provider: provider ?? null });
};
