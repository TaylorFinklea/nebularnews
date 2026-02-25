import { json } from '@sveltejs/kit';
import { dbAll, dbRun, now } from '$lib/server/db';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  DEFAULT_AUTO_TAGGING_ENABLED,
  clampAutoTagMaxPerArticle,
  clampAutoReadDelayMs,
  clampJobProcessorBatchSize,
  clampInitialFeedLookbackDays,
  clampRetentionDays,
  clampMaxFeedsPerPoll,
  clampMaxItemsPerPoll,
  clampEventsPollMs,
  clampDashboardRefreshMinMs,
  clampDashboardTopRatedCutoff,
  clampDashboardTopRatedLimit,
  clampSchedulerJobsIntervalMinutes,
  clampSchedulerPollIntervalMinutes,
  clampSchedulerPullSlicesPerTick,
  clampSchedulerPullSliceBudgetMs,
  clampSchedulerJobBudgetIdleMs,
  clampSchedulerJobBudgetWhilePullMs,
  parseBooleanSetting,
  getAutoReadDelayMs,
  getAutoTaggingEnabled,
  getAutoTagMaxPerArticle,
  getArticleCardLayout,
  getDashboardTopRatedLayout,
  getConfiguredChatProviderModel,
  getDashboardTopRatedConfig,
  getConfiguredIngestProviderModel,
  getJobProcessorBatchSize,
  getSchedulerJobsIntervalMinutes,
  getSchedulerPollIntervalMinutes,
  getSchedulerPullSlicesPerTick,
  getSchedulerPullSliceBudgetMs,
  getSchedulerJobBudgetIdleMs,
  getSchedulerJobBudgetWhilePullMs,
  getSchedulerAutoQueueTodayMissing,
  getFeatureModelLanes,
  getInitialFeedLookbackDays,
  getMaxFeedsPerPoll,
  getMaxItemsPerPoll,
  getEventsPollMs,
  getDashboardRefreshMinMs,
  getRetentionConfig,
  getScorePromptConfig,
  getSetting,
  setSetting
} from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const GET = async ({ platform }) => {
  const db = platform.env.DB;
  const featureLanes = await getFeatureModelLanes(db);
  const ingestModel = await getConfiguredIngestProviderModel(db, platform.env);
  const chatModel = await getConfiguredChatProviderModel(db, platform.env);
  const scorePrompt = await getScorePromptConfig(db);
  const dashboardTopRated = await getDashboardTopRatedConfig(db);
  const dashboardTopRatedLayout = await getDashboardTopRatedLayout(db);
  const retention = await getRetentionConfig(db);
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
    pollInterval: String(await getSchedulerPollIntervalMinutes(db)),
    initialFeedLookbackDays: await getInitialFeedLookbackDays(db),
    maxFeedsPerPoll: await getMaxFeedsPerPoll(db, platform.env),
    maxItemsPerPoll: await getMaxItemsPerPoll(db, platform.env),
    eventsPollMs: await getEventsPollMs(db, platform.env),
    dashboardRefreshMinMs: await getDashboardRefreshMinMs(db, platform.env),
    retentionDays: retention.days,
    retentionMode: retention.mode,
    autoReadDelayMs: await getAutoReadDelayMs(db),
    autoTaggingEnabled: await getAutoTaggingEnabled(db),
    autoTagMaxPerArticle: await getAutoTagMaxPerArticle(db),
    jobProcessorBatchSize: await getJobProcessorBatchSize(db, platform.env),
    jobsIntervalMinutes: await getSchedulerJobsIntervalMinutes(db),
    pollIntervalMinutes: await getSchedulerPollIntervalMinutes(db),
    pullSlicesPerTick: await getSchedulerPullSlicesPerTick(db),
    pullSliceBudgetMs: await getSchedulerPullSliceBudgetMs(db),
    jobBudgetIdleMs: await getSchedulerJobBudgetIdleMs(db),
    jobBudgetWhilePullMs: await getSchedulerJobBudgetWhilePullMs(db),
    autoQueueTodayMissing: await getSchedulerAutoQueueTodayMissing(db),
    articleCardLayout: await getArticleCardLayout(db),
    dashboardTopRatedLayout,
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

export const POST = async ({ request, platform, locals }) => {
  const body = await request.json();
  const entries: [string, string][] = [];
  const validProviders = new Set(['openai', 'anthropic']);
  const validEfforts = new Set(['minimal', 'low', 'medium', 'high']);
  const validModelLanes = new Set(['pipeline', 'chat']);
  const validArticleCardLayouts = new Set(['split', 'stacked']);
  const validDashboardTopRatedLayouts = new Set(['split', 'stacked']);
  const validRetentionModes = new Set(['archive', 'delete']);
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
  if (body?.articleCardLayout && validArticleCardLayouts.has(body.articleCardLayout)) {
    entries.push(['article_card_layout', body.articleCardLayout]);
  }
  if (body?.dashboardTopRatedLayout && validDashboardTopRatedLayouts.has(body.dashboardTopRatedLayout)) {
    entries.push(['dashboard_top_rated_layout', body.dashboardTopRatedLayout]);
  }
  if (body?.pollInterval !== undefined && body?.pollInterval !== null) {
    entries.push(['scheduler_poll_interval_min', String(clampSchedulerPollIntervalMinutes(body.pollInterval))]);
  }
  if (body?.initialFeedLookbackDays !== undefined && body?.initialFeedLookbackDays !== null) {
    entries.push(['initial_feed_lookback_days', String(clampInitialFeedLookbackDays(body.initialFeedLookbackDays))]);
  }
  if (body?.maxFeedsPerPoll !== undefined && body?.maxFeedsPerPoll !== null) {
    entries.push(['max_feeds_per_poll', String(clampMaxFeedsPerPoll(body.maxFeedsPerPoll))]);
  }
  if (body?.maxItemsPerPoll !== undefined && body?.maxItemsPerPoll !== null) {
    entries.push(['max_items_per_poll', String(clampMaxItemsPerPoll(body.maxItemsPerPoll))]);
  }
  if (body?.eventsPollMs !== undefined && body?.eventsPollMs !== null) {
    entries.push(['events_poll_ms', String(clampEventsPollMs(body.eventsPollMs))]);
  }
  if (body?.dashboardRefreshMinMs !== undefined && body?.dashboardRefreshMinMs !== null) {
    entries.push(['dashboard_refresh_min_ms', String(clampDashboardRefreshMinMs(body.dashboardRefreshMinMs))]);
  }
  if (body?.retentionDays !== undefined && body?.retentionDays !== null) {
    entries.push(['retention_days', String(clampRetentionDays(body.retentionDays))]);
  }
  if (body?.retentionMode && validRetentionModes.has(body.retentionMode)) {
    entries.push(['retention_mode', body.retentionMode]);
  }
  if (body?.autoReadDelayMs !== undefined && body?.autoReadDelayMs !== null) {
    entries.push(['auto_read_delay_ms', String(clampAutoReadDelayMs(body.autoReadDelayMs))]);
  }
  if (body?.autoTaggingEnabled !== undefined && body?.autoTaggingEnabled !== null) {
    entries.push([
      'auto_tagging_enabled',
      parseBooleanSetting(body.autoTaggingEnabled, DEFAULT_AUTO_TAGGING_ENABLED) ? '1' : '0'
    ]);
  }
  if (body?.autoTagMaxPerArticle !== undefined && body?.autoTagMaxPerArticle !== null) {
    entries.push(['auto_tag_max_per_article', String(clampAutoTagMaxPerArticle(body.autoTagMaxPerArticle))]);
  }
  if (body?.jobProcessorBatchSize !== undefined && body?.jobProcessorBatchSize !== null) {
    entries.push(['job_processor_batch_size', String(clampJobProcessorBatchSize(body.jobProcessorBatchSize))]);
  }
  if (body?.jobsIntervalMinutes !== undefined && body?.jobsIntervalMinutes !== null) {
    entries.push(['scheduler_jobs_interval_min', String(clampSchedulerJobsIntervalMinutes(body.jobsIntervalMinutes))]);
  }
  if (body?.pollIntervalMinutes !== undefined && body?.pollIntervalMinutes !== null) {
    entries.push(['scheduler_poll_interval_min', String(clampSchedulerPollIntervalMinutes(body.pollIntervalMinutes))]);
  }
  if (body?.pullSlicesPerTick !== undefined && body?.pullSlicesPerTick !== null) {
    entries.push(['scheduler_pull_slices_per_tick', String(clampSchedulerPullSlicesPerTick(body.pullSlicesPerTick))]);
  }
  if (body?.pullSliceBudgetMs !== undefined && body?.pullSliceBudgetMs !== null) {
    entries.push(['scheduler_pull_slice_budget_ms', String(clampSchedulerPullSliceBudgetMs(body.pullSliceBudgetMs))]);
  }
  if (body?.jobBudgetIdleMs !== undefined && body?.jobBudgetIdleMs !== null) {
    entries.push(['scheduler_job_budget_idle_ms', String(clampSchedulerJobBudgetIdleMs(body.jobBudgetIdleMs))]);
  }
  if (body?.jobBudgetWhilePullMs !== undefined && body?.jobBudgetWhilePullMs !== null) {
    entries.push([
      'scheduler_job_budget_while_pull_ms',
      String(clampSchedulerJobBudgetWhilePullMs(body.jobBudgetWhilePullMs))
    ]);
  }
  if (body?.autoQueueTodayMissing !== undefined && body?.autoQueueTodayMissing !== null) {
    entries.push(['scheduler_auto_queue_today_missing', parseBooleanSetting(body.autoQueueTodayMissing, true) ? '1' : '0']);
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

  const autoTaggingDisabled = entries.some(
    ([key, value]) => key === 'auto_tagging_enabled' && (value === '0' || value.toLowerCase() === 'false')
  );
  if (autoTaggingDisabled) {
    await dbRun(
      platform.env.DB,
      `UPDATE jobs
       SET status = 'cancelled',
           updated_at = ?
       WHERE type = 'auto_tag'
         AND status = 'pending'`,
      [now()]
    );
  }

  await recordAuditEvent(platform.env.DB, {
    actor: 'admin',
    action: 'settings.update',
    requestId: locals.requestId,
    metadata: {
      updated_keys: entries.map(([key]) => key)
    }
  });

  return json({ ok: true });
};
