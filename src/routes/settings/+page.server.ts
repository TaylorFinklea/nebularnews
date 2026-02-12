import { dbAll } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';
import { ensurePreferenceProfile } from '$lib/server/profile';

export const load = async ({ platform }) => {
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
    summaryLength: (await getSetting(db, 'summary_length')) ?? 'short'
  };

  const keys = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keyMap = { openai: false, anthropic: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider as 'openai' | 'anthropic'] = true;
  }

  const profile = await ensurePreferenceProfile(db);

  return { settings, keyMap, profile };
};
