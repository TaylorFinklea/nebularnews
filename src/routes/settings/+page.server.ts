import { dbAll } from '$lib/server/db';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  getChatProviderModel,
  getIngestProviderModel,
  getScorePromptConfig,
  getSetting
} from '$lib/server/settings';
import { ensurePreferenceProfile } from '$lib/server/profile';

export const load = async ({ platform }) => {
  const db = platform.env.DB;
  const ingestModel = await getIngestProviderModel(db, platform.env);
  const chatModel = await getChatProviderModel(db, platform.env);
  const scorePrompt = await getScorePromptConfig(db);
  const settings = {
    ingestProvider: ingestModel.provider,
    ingestModel: ingestModel.model,
    ingestReasoningEffort: ingestModel.reasoningEffort,
    chatProvider: chatModel.provider,
    chatModel: chatModel.model,
    chatReasoningEffort: chatModel.reasoningEffort,
    scoreSystemPrompt: scorePrompt.systemPrompt,
    scoreUserPromptTemplate: scorePrompt.userPromptTemplate,
    summaryStyle: (await getSetting(db, 'summary_style')) ?? 'concise',
    summaryLength: (await getSetting(db, 'summary_length')) ?? 'short'
  };

  const keys = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keyMap = { openai: false, anthropic: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider as 'openai' | 'anthropic'] = true;
  }

  const profile = await ensurePreferenceProfile(db);

  const scorePromptDefaults = {
    scoreSystemPrompt: DEFAULT_SCORE_SYSTEM_PROMPT,
    scoreUserPromptTemplate: DEFAULT_SCORE_USER_PROMPT_TEMPLATE
  };

  return { settings, keyMap, profile, scorePromptDefaults };
};
