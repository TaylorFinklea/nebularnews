import { dbAll } from '$lib/server/db';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  getFeatureModelLanes,
  MAX_AUTO_READ_DELAY_MS,
  MIN_AUTO_READ_DELAY_MS,
  getAutoReadDelayMs,
  getConfiguredChatProviderModel,
  getConfiguredIngestProviderModel,
  getScorePromptConfig,
  getSetting
} from '$lib/server/settings';
import { ensurePreferenceProfile } from '$lib/server/profile';

export const load = async ({ platform }) => {
  const db = platform.env.DB;
  const featureLanes = await getFeatureModelLanes(db);
  const ingestModel = await getConfiguredIngestProviderModel(db, platform.env);
  const chatModel = await getConfiguredChatProviderModel(db, platform.env);
  const scorePrompt = await getScorePromptConfig(db);
  const settings = {
    featureLanes: {
      summaries: featureLanes.summaries,
      scoring: featureLanes.scoring,
      profileRefresh: featureLanes.profile_refresh,
      keyPoints: featureLanes.key_points,
      autoTagging: featureLanes.auto_tagging,
      articleChat: featureLanes.article_chat,
      globalChat: featureLanes.global_chat
    },
    ingestProvider: ingestModel.provider,
    ingestModel: ingestModel.model,
    ingestReasoningEffort: ingestModel.reasoningEffort,
    chatProvider: chatModel.provider,
    chatModel: chatModel.model,
    chatReasoningEffort: chatModel.reasoningEffort,
    scoreSystemPrompt: scorePrompt.systemPrompt,
    scoreUserPromptTemplate: scorePrompt.userPromptTemplate,
    summaryStyle: (await getSetting(db, 'summary_style')) ?? 'concise',
    summaryLength: (await getSetting(db, 'summary_length')) ?? 'short',
    autoReadDelayMs: await getAutoReadDelayMs(db)
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

  return { settings, keyMap, profile, scorePromptDefaults, autoReadDelayRange: { min: MIN_AUTO_READ_DELAY_MS, max: MAX_AUTO_READ_DELAY_MS } };
};
