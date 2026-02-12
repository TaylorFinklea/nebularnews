import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import { getSetting, setSetting } from '$lib/server/settings';

export const GET = async ({ platform }) => {
  const db = platform.env.DB;
  const reasoningEffort = await getSetting(db, 'reasoning_effort');
  const settings = {
    defaultProvider: (await getSetting(db, 'default_provider')) ?? platform.env.DEFAULT_PROVIDER ?? 'openai',
    defaultModel: (await getSetting(db, 'default_model')) ?? platform.env.DEFAULT_MODEL ?? 'gpt-4o-mini',
    reasoningEffort:
      (reasoningEffort === 'minimal' || reasoningEffort === 'low' || reasoningEffort === 'medium' || reasoningEffort === 'high'
        ? reasoningEffort
        : platform.env.DEFAULT_REASONING_EFFORT) ?? 'medium',
    summaryStyle: (await getSetting(db, 'summary_style')) ?? 'concise',
    summaryLength: (await getSetting(db, 'summary_length')) ?? 'short',
    pollInterval: (await getSetting(db, 'poll_interval')) ?? '60'
  };

  const keys = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keyMap = { openai: false, anthropic: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider as 'openai' | 'anthropic'] = true;
  }

  return json({ settings, keys: keyMap });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json();
  const entries: [string, string][] = [];
  if (body?.defaultProvider) entries.push(['default_provider', body.defaultProvider]);
  if (body?.defaultModel) entries.push(['default_model', body.defaultModel]);
  if (
    body?.reasoningEffort &&
    ['minimal', 'low', 'medium', 'high'].includes(body.reasoningEffort)
  ) {
    entries.push(['reasoning_effort', body.reasoningEffort]);
  }
  if (body?.summaryStyle) entries.push(['summary_style', body.summaryStyle]);
  if (body?.summaryLength) entries.push(['summary_length', body.summaryLength]);
  if (body?.pollInterval) entries.push(['poll_interval', String(body.pollInterval)]);

  for (const [key, value] of entries) {
    await setSetting(platform.env.DB, key, value);
  }

  return json({ ok: true });
};
