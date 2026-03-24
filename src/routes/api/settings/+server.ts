import { json } from '@sveltejs/kit';
import { dbAll } from '$lib/server/db';
import {
  getBrowserScrapingEnabled,
  getBrowserScrapeProvider,
  setBrowserScrapeKey,
  deleteBrowserScrapeKey,
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  DEFAULT_AUTO_TAGGING_ENABLED,
  clampAutoTagMaxPerArticle,
  clampAutoReadDelayMs,
  clampJobProcessorBatchSize,
  clampInitialFeedLookbackDays,
  clampRetentionDays,
  clampRetentionArchiveDays,
  clampRetentionDeleteDays,
  clampMaxFeedsPerPoll,
  clampMaxItemsPerPoll,
  clampEventsPollMs,
  clampDashboardRefreshMinMs,
  clampDashboardQueueWindowDays,
  clampDashboardQueueLimit,
  clampDashboardQueueScoreCutoff,
  clampNewsBriefLookbackHours,
  clampNewsBriefScoreCutoff,
  clampSchedulerJobsIntervalMinutes,
  clampSchedulerPollIntervalMinutes,
  clampSchedulerPullSlicesPerTick,
  clampSchedulerPullSliceBudgetMs,
  clampSchedulerJobBudgetIdleMs,
  clampSchedulerJobBudgetWhilePullMs,
  parseBooleanSetting,
  getAutoReadDelayMs,
  getAutoTagMaxPerArticle,
  getTaggingMethod,
  getArticleCardLayout,
  getDashboardQueueConfig,
  getConfiguredModelB,
  getConfiguredModelA,
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
  getNewsBriefConfig,
  getScorePromptConfig,
  getSetting,
  setSetting,
  getScoringMethod,
  getScoringAiEnhancementThreshold,
  getScoringLearningRate,
  clampScoringAiEnhancementThreshold,
  validateNewsBriefTimezone,
  validateNewsBriefTime
} from '$lib/server/settings';
import { recordAuditEvent } from '$lib/server/audit';

export const GET = async ({ platform }) => {
  const db = platform.env.DB;
  const featureLanes = await getFeatureModelLanes(db);
  const modelA = await getConfiguredModelA(db, platform.env);
  const modelB = await getConfiguredModelB(db, platform.env);
  const scorePrompt = await getScorePromptConfig(db);
  const dashboardQueue = await getDashboardQueueConfig(db);
  const newsBrief = await getNewsBriefConfig(db);
  const retention = await getRetentionConfig(db);
  const taggingMethod = await getTaggingMethod(db);
  const settings = {
    featureLanes: {
      summaries: featureLanes.summaries,
      scoring: featureLanes.scoring,
      profileRefresh: featureLanes.profile_refresh,
      keyPoints: featureLanes.key_points,
      autoTagging: featureLanes.auto_tagging
    },
    modelAProvider: modelA.provider,
    modelAModel: modelA.model,
    modelAReasoningEffort: modelA.reasoningEffort,
    modelBProvider: modelB.provider,
    modelBModel: modelB.model,
    modelBReasoningEffort: modelB.reasoningEffort,
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
    retentionArchiveDays: retention.archiveDays,
    retentionDeleteDays: retention.deleteDays,
    autoReadDelayMs: await getAutoReadDelayMs(db),
    taggingMethod,
    autoTaggingEnabled: taggingMethod === 'hybrid',
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
    dashboardQueueWindowDays: dashboardQueue.windowDays,
    dashboardQueueLimit: dashboardQueue.limit,
    dashboardQueueScoreCutoff: dashboardQueue.scoreCutoff,
    newsBriefEnabled: newsBrief.enabled,
    newsBriefTimezone: newsBrief.timezone,
    newsBriefMorningTime: newsBrief.morningTime,
    newsBriefEveningTime: newsBrief.eveningTime,
    newsBriefLookbackHours: newsBrief.lookbackHours,
    newsBriefScoreCutoff: newsBrief.scoreCutoff,
    scoringMethod: await getScoringMethod(db),
    scoringAiEnhancementThreshold: await getScoringAiEnhancementThreshold(db),
    scoringLearningRate: await getScoringLearningRate(db),
    browserScrapingEnabled: await getBrowserScrapingEnabled(db),
    browserScrapeProvider: await getBrowserScrapeProvider(db),
    browserScrapeApiUrl: (await getSetting(db, 'browser_scrape_api_url')) ?? ''
  };

  const keys = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keyMap: Record<string, boolean> = { openai: false, anthropic: false, browser_scrape: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider] = true;
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
  const validModelLanes = new Set(['model_a', 'model_b']);
  const validArticleCardLayouts = new Set(['split', 'stacked']);
  const validRetentionModes = new Set(['archive', 'delete']);
  const featureLaneKeys: Record<string, string> = {
    summaries: 'lane_summaries',
    scoring: 'lane_scoring',
    profileRefresh: 'lane_profile_refresh',
    keyPoints: 'lane_key_points',
    autoTagging: 'lane_auto_tagging'
  };

  for (const [bodyKey, settingKey] of Object.entries(featureLaneKeys)) {
    const value = body?.featureLanes?.[bodyKey];
    if (value && validModelLanes.has(value)) {
      entries.push([settingKey, value]);
    }
  }

  if (body?.modelAProvider && validProviders.has(body.modelAProvider)) {
    entries.push(['ingest_provider', body.modelAProvider]);
  }
  if (body?.modelAModel && String(body.modelAModel).trim()) {
    entries.push(['ingest_model', String(body.modelAModel).trim()]);
  }
  if (body?.modelAReasoningEffort && validEfforts.has(body.modelAReasoningEffort)) {
    entries.push(['ingest_reasoning_effort', body.modelAReasoningEffort]);
  }

  if (body?.modelBProvider && validProviders.has(body.modelBProvider)) {
    entries.push(['chat_provider', body.modelBProvider]);
  }
  if (body?.modelBModel && String(body.modelBModel).trim()) {
    entries.push(['chat_model', String(body.modelBModel).trim()]);
  }
  if (body?.modelBReasoningEffort && validEfforts.has(body.modelBReasoningEffort)) {
    entries.push(['chat_reasoning_effort', body.modelBReasoningEffort]);
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
  if (body?.retentionArchiveDays !== undefined && body?.retentionArchiveDays !== null) {
    entries.push(['retention_days', String(clampRetentionArchiveDays(body.retentionArchiveDays))]);
  }
  if (body?.retentionDeleteDays !== undefined && body?.retentionDeleteDays !== null) {
    entries.push(['retention_delete_days', String(clampRetentionDeleteDays(body.retentionDeleteDays))]);
  }
  if (body?.retentionMode && validRetentionModes.has(body.retentionMode)) {
    entries.push(['retention_mode', body.retentionMode]);
  }
  if (body?.autoReadDelayMs !== undefined && body?.autoReadDelayMs !== null) {
    entries.push(['auto_read_delay_ms', String(clampAutoReadDelayMs(body.autoReadDelayMs))]);
  }
  const validTaggingMethods = new Set(['algorithmic', 'hybrid']);
  if (body?.taggingMethod && validTaggingMethods.has(body.taggingMethod)) {
    const taggingMethod = String(body.taggingMethod);
    entries.push(['tagging_method', taggingMethod]);
    entries.push(['auto_tagging_enabled', taggingMethod === 'hybrid' ? '1' : '0']);
  } else if (body?.autoTaggingEnabled !== undefined && body?.autoTaggingEnabled !== null) {
    const enabled = parseBooleanSetting(body.autoTaggingEnabled, DEFAULT_AUTO_TAGGING_ENABLED);
    entries.push(['tagging_method', enabled ? 'hybrid' : 'algorithmic']);
    entries.push(['auto_tagging_enabled', enabled ? '1' : '0']);
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
  if (body?.dashboardQueueWindowDays !== undefined && body?.dashboardQueueWindowDays !== null) {
    entries.push([
      'dashboard_queue_window_days',
      String(clampDashboardQueueWindowDays(body.dashboardQueueWindowDays))
    ]);
  }
  if (body?.newsBriefEnabled !== undefined && body?.newsBriefEnabled !== null) {
    entries.push(['news_brief_enabled', parseBooleanSetting(body.newsBriefEnabled, true) ? '1' : '0']);
  }
  if (body?.newsBriefTimezone !== undefined && body?.newsBriefTimezone !== null) {
    const timezone = validateNewsBriefTimezone(body.newsBriefTimezone);
    if (!timezone) {
      return json({ error: { message: 'News Brief timezone must be a valid IANA timezone.' } }, { status: 400 });
    }
    entries.push(['news_brief_timezone', timezone]);
  }
  const nextMorningTime =
    body?.newsBriefMorningTime !== undefined && body?.newsBriefMorningTime !== null
      ? validateNewsBriefTime(body.newsBriefMorningTime)
      : null;
  if (body?.newsBriefMorningTime !== undefined && body?.newsBriefMorningTime !== null && !nextMorningTime) {
    return json({ error: { message: 'News Brief morning time must use HH:mm format.' } }, { status: 400 });
  }
  const nextEveningTime =
    body?.newsBriefEveningTime !== undefined && body?.newsBriefEveningTime !== null
      ? validateNewsBriefTime(body.newsBriefEveningTime)
      : null;
  if (body?.newsBriefEveningTime !== undefined && body?.newsBriefEveningTime !== null && !nextEveningTime) {
    return json({ error: { message: 'News Brief evening time must use HH:mm format.' } }, { status: 400 });
  }
  if (nextMorningTime !== null || nextEveningTime !== null) {
    const currentNewsBrief = await getNewsBriefConfig(platform.env.DB);
    const morningTime = nextMorningTime ?? currentNewsBrief.morningTime;
    const eveningTime = nextEveningTime ?? currentNewsBrief.eveningTime;
    if (morningTime >= eveningTime) {
      return json(
        { error: { message: 'News Brief morning time must be earlier than evening time.' } },
        { status: 400 }
      );
    }
    if (nextMorningTime !== null) entries.push(['news_brief_morning_time', nextMorningTime]);
    if (nextEveningTime !== null) entries.push(['news_brief_evening_time', nextEveningTime]);
  }
  if (body?.newsBriefLookbackHours !== undefined && body?.newsBriefLookbackHours !== null) {
    entries.push(['news_brief_lookback_hours', String(clampNewsBriefLookbackHours(body.newsBriefLookbackHours))]);
  }
  if (body?.newsBriefScoreCutoff !== undefined && body?.newsBriefScoreCutoff !== null) {
    entries.push(['news_brief_score_cutoff', String(clampNewsBriefScoreCutoff(body.newsBriefScoreCutoff))]);
  }

  const queueLimitInput = body?.dashboardQueueLimit ?? body?.dashboardTopRatedLimit;
  if (queueLimitInput !== undefined && queueLimitInput !== null) {
    const normalizedLimit = String(clampDashboardQueueLimit(queueLimitInput));
    entries.push(['dashboard_queue_limit', normalizedLimit]);
    if (body?.dashboardTopRatedLimit !== undefined && body?.dashboardTopRatedLimit !== null) {
      entries.push(['dashboard_top_rated_limit', normalizedLimit]);
    }
  }

  const queueCutoffInput = body?.dashboardQueueScoreCutoff ?? body?.dashboardTopRatedCutoff;
  if (queueCutoffInput !== undefined && queueCutoffInput !== null) {
    const normalizedCutoff = String(clampDashboardQueueScoreCutoff(queueCutoffInput));
    entries.push(['dashboard_queue_score_cutoff', normalizedCutoff]);
    if (body?.dashboardTopRatedCutoff !== undefined && body?.dashboardTopRatedCutoff !== null) {
      entries.push(['dashboard_top_rated_cutoff', normalizedCutoff]);
    }
  }
  // Scoring method settings
  const validScoringMethods = new Set(['ai', 'algorithmic', 'hybrid']);
  if (body?.scoringMethod && validScoringMethods.has(body.scoringMethod)) {
    entries.push(['scoring_method', body.scoringMethod]);
  }
  if (body?.scoringAiEnhancementThreshold !== undefined && body?.scoringAiEnhancementThreshold !== null) {
    entries.push([
      'scoring_ai_enhancement_threshold',
      String(clampScoringAiEnhancementThreshold(body.scoringAiEnhancementThreshold))
    ]);
  }
  if (body?.scoringLearningRate !== undefined && body?.scoringLearningRate !== null) {
    const rate = Number(body.scoringLearningRate);
    if (Number.isFinite(rate) && rate > 0 && rate <= 1) {
      entries.push(['scoring_learning_rate', String(rate)]);
    }
  }

  if (typeof body?.scoreSystemPrompt === 'string' && body.scoreSystemPrompt.trim()) {
    entries.push(['score_system_prompt', body.scoreSystemPrompt.trim()]);
  }
  if (typeof body?.scoreUserPromptTemplate === 'string' && body.scoreUserPromptTemplate.trim()) {
    entries.push(['score_user_prompt_template', body.scoreUserPromptTemplate.trim()]);
  }

  // Browser scraping settings
  if (body?.browserScrapingEnabled !== undefined && body?.browserScrapingEnabled !== null) {
    entries.push(['browser_scraping_enabled', parseBooleanSetting(body.browserScrapingEnabled, false) ? '1' : '0']);
  }
  const validBrowserScrapeProviders = new Set(['cloudflare', 'browserless', 'scrapingbee', 'generic']);
  if (body?.browserScrapeProvider && validBrowserScrapeProviders.has(body.browserScrapeProvider)) {
    entries.push(['browser_scrape_provider', body.browserScrapeProvider]);
  }
  if (typeof body?.browserScrapeApiUrl === 'string') {
    entries.push(['browser_scrape_api_url', body.browserScrapeApiUrl.trim()]);
  }
  if (typeof body?.browserScrapeApiKey === 'string' && body.browserScrapeApiKey.trim()) {
    await setBrowserScrapeKey(platform.env.DB, platform.env, body.browserScrapeApiKey.trim());
  } else if (body?.browserScrapeApiKey === null) {
    await deleteBrowserScrapeKey(platform.env.DB);
  }

  for (const [key, value] of entries) {
    await setSetting(platform.env.DB, key, value);
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
