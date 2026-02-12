import { json } from '@sveltejs/kit';
import { listProviderModels } from '$lib/server/models';
import { getProviderKey } from '$lib/server/settings';
import type { Provider } from '$lib/server/llm';

const isProvider = (value: string): value is Provider => value === 'openai' || value === 'anthropic';

export const GET = async ({ url, platform }) => {
  const providerParam = url.searchParams.get('provider') ?? '';
  if (!isProvider(providerParam)) {
    return json({ error: 'Invalid provider' }, { status: 400 });
  }

  const apiKey = await getProviderKey(platform.env.DB, platform.env, providerParam);
  if (!apiKey) {
    return json({ error: `No ${providerParam} API key saved` }, { status: 400 });
  }

  try {
    const models = await listProviderModels(providerParam, apiKey);
    return json({ provider: providerParam, fetchedAt: Date.now(), models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 502 });
  }
};
