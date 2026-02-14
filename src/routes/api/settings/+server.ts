import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  clampAutoReadDelayMs,
  clampDashboardTopRatedCutoff,
  clampDashboardTopRatedLimit,
  getAutoReadDelayMs,
  getConfiguredChatProviderModel,
  getDashboardTopRatedConfig,
  getConfiguredIngestProviderModel,
  getFeatureModelLanes,
  getScorePromptConfig,
  getSetting,
  setSetting
} from '$lib/server/settings';

export const GET = async ({ platform }) => {
  const db = platform.env.DB;
  const featureLanes = await getFeatureModelLanes(db);
  const ingestModel = await getConfiguredIngestProviderModel(db, platform.env);
  const chatModel = await getConfiguredChatProviderModel(db, platform.env);
  const scorePrompt = await getScorePromptConfig(db);
  const dashboardTopRated = await getDashboardTopRatedConfig(db);
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
    pollInterval: (await getSetting(db, 'poll_interval')) ?? '60',
    autoReadDelayMs: await getAutoReadDelayMs(db),
    dashboardTopRatedCutoff: dashboardTopRated.cutoff,
    dashboardTopRatedLimit: dashboardTopRated.limit
  };

  const keys = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keyMap = { openai: false, anthropic: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider as 'openai' | 'anthropic'] = true;
  }

  return json({
    settings,
    keys: keyMap,
    scorePromptDefaults: {
      scoreSystemPrompt: DEFAULT_SCORE_SYSTEM_PROMPT,
      scoreUserPromptTemplate: DEFAULT_SCORE_USER_PROMPT_TEMPLATE
    }
  });
};

export const POST = async ({ request, platform }) => {
  const body = await request.json();
  const entries: [string, string][] = [];
  const validProviders = new Set(['openai', 'anthropic']);
  const validEfforts = new Set(['minimal', 'low', 'medium', 'high']);
  const validModelLanes = new Set(['pipeline', 'chat']);
  const featureLaneKeys: Record<string, string> = {
    summaries: 'lane_summaries',
    scoring: 'lane_scoring',
    profileRefresh: 'lane_profile_refresh',
    keyPoints: 'lane_key_points',
    autoTagging: 'lane_auto_tagging',
    articleChat: 'lane_article_chat',
    globalChat: 'lane_global_chat'
  };

  for (const [bodyKey, settingKey] of Object.entries(featureLaneKeys)) {
    const value = body?.featureLanes?.[bodyKey];
    if (value && validModelLanes.has(value)) {
      entries.push([settingKey, value]);
    }
  }

  if (body?.ingestProvider && validProviders.has(body.ingestProvider)) {
    entries.push(['ingest_provider', body.ingestProvider]);
  }
  if (body?.ingestModel && String(body.ingestModel).trim()) {
    entries.push(['ingest_model', String(body.ingestModel).trim()]);
  }
  if (body?.ingestReasoningEffort && validEfforts.has(body.ingestReasoningEffort)) {
    entries.push(['ingest_reasoning_effort', body.ingestReasoningEffort]);
  }

  if (body?.chatProvider && validProviders.has(body.chatProvider)) {
    entries.push(['chat_provider', body.chatProvider]);
  }
  if (body?.chatModel && String(body.chatModel).trim()) {
    entries.push(['chat_model', String(body.chatModel).trim()]);
  }
  if (body?.chatReasoningEffort && validEfforts.has(body.chatReasoningEffort)) {
    entries.push(['chat_reasoning_effort', body.chatReasoningEffort]);
  }

  // Backward-compatible keys used by earlier builds.
  if (body?.defaultProvider && validProviders.has(body.defaultProvider)) {
    entries.push(['default_provider', body.defaultProvider]);
  }
  if (body?.defaultModel && String(body.defaultModel).trim()) {
    entries.push(['default_model', String(body.defaultModel).trim()]);
  }
  if (body?.reasoningEffort && validEfforts.has(body.reasoningEffort)) {
    entries.push(['reasoning_effort', body.reasoningEffort]);
  }

  if (body?.summaryStyle) entries.push(['summary_style', body.summaryStyle]);
  if (body?.summaryLength) entries.push(['summary_length', body.summaryLength]);
  if (body?.pollInterval) entries.push(['poll_interval', String(body.pollInterval)]);
  if (body?.autoReadDelayMs !== undefined && body?.autoReadDelayMs !== null) {
    entries.push(['auto_read_delay_ms', String(clampAutoReadDelayMs(body.autoReadDelayMs))]);
  }
  if (body?.dashboardTopRatedCutoff !== undefined && body?.dashboardTopRatedCutoff !== null) {
    entries.push(['dashboard_top_rated_cutoff', String(clampDashboardTopRatedCutoff(body.dashboardTopRatedCutoff))]);
  }
  if (body?.dashboardTopRatedLimit !== undefined && body?.dashboardTopRatedLimit !== null) {
    entries.push(['dashboard_top_rated_limit', String(clampDashboardTopRatedLimit(body.dashboardTopRatedLimit))]);
  }
  if (typeof body?.scoreSystemPrompt === 'string' && body.scoreSystemPrompt.trim()) {
    entries.push(['score_system_prompt', body.scoreSystemPrompt.trim()]);
  }
  if (typeof body?.scoreUserPromptTemplate === 'string' && body.scoreUserPromptTemplate.trim()) {
    entries.push(['score_user_prompt_template', body.scoreUserPromptTemplate.trim()]);
  }

  for (const [key, value] of entries) {
    await setSetting(platform.env.DB, key, value);
  }

  return json({ ok: true });
};
