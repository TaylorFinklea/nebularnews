import { dbAll } from '$lib/server/db';
import { getLatestNewsBriefEditionSummary } from '$lib/server/news-brief';
import { loadSignalWeights } from '$lib/server/scoring/engine';
import { getScoringObservabilitySummary } from '$lib/server/scoring-observability';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  DEFAULT_AUTO_TAGGING_ENABLED,
  DEFAULT_AUTO_TAG_MAX_PER_ARTICLE,
  DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS,
  DEFAULT_DASHBOARD_QUEUE_LIMIT,
  DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF,
  DEFAULT_NEWS_BRIEF_ENABLED,
  DEFAULT_NEWS_BRIEF_TIMEZONE,
  DEFAULT_NEWS_BRIEF_MORNING_TIME,
  DEFAULT_NEWS_BRIEF_EVENING_TIME,
  DEFAULT_NEWS_BRIEF_LOOKBACK_HOURS,
  DEFAULT_NEWS_BRIEF_SCORE_CUTOFF,
  DEFAULT_DASHBOARD_REFRESH_MIN_MS,
  DEFAULT_EVENTS_POLL_MS,
  DEFAULT_INITIAL_FEED_LOOKBACK_DAYS,
  DEFAULT_MAX_FEEDS_PER_POLL,
  DEFAULT_MAX_ITEMS_PER_POLL,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_JOB_PROCESSOR_BATCH_SIZE,
  DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN,
  DEFAULT_SCHEDULER_POLL_INTERVAL_MIN,
  DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK,
  DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  DEFAULT_SCHEDULER_AUTO_QUEUE_TODAY_MISSING,
  MAX_DASHBOARD_QUEUE_WINDOW_DAYS,
  MAX_DASHBOARD_QUEUE_LIMIT,
  MAX_DASHBOARD_QUEUE_SCORE_CUTOFF,
  MAX_NEWS_BRIEF_LOOKBACK_HOURS,
  MAX_NEWS_BRIEF_SCORE_CUTOFF,
  MAX_DASHBOARD_REFRESH_MIN_MS,
  MAX_EVENTS_POLL_MS,
  MAX_INITIAL_FEED_LOOKBACK_DAYS,
  MAX_MAX_FEEDS_PER_POLL,
  MAX_MAX_ITEMS_PER_POLL,
  MAX_RETENTION_DAYS,
  MAX_JOB_PROCESSOR_BATCH_SIZE,
  MAX_AUTO_TAG_MAX_PER_ARTICLE,
  MAX_SCHEDULER_JOBS_INTERVAL_MIN,
  MAX_SCHEDULER_POLL_INTERVAL_MIN,
  MAX_SCHEDULER_PULL_SLICES_PER_TICK,
  MAX_SCHEDULER_PULL_SLICE_BUDGET_MS,
  MAX_SCHEDULER_JOB_BUDGET_IDLE_MS,
  MAX_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  MIN_DASHBOARD_QUEUE_WINDOW_DAYS,
  MIN_DASHBOARD_QUEUE_LIMIT,
  MIN_DASHBOARD_QUEUE_SCORE_CUTOFF,
  MIN_NEWS_BRIEF_LOOKBACK_HOURS,
  MIN_NEWS_BRIEF_SCORE_CUTOFF,
  MIN_DASHBOARD_REFRESH_MIN_MS,
  MIN_EVENTS_POLL_MS,
  MIN_INITIAL_FEED_LOOKBACK_DAYS,
  MIN_MAX_FEEDS_PER_POLL,
  MIN_MAX_ITEMS_PER_POLL,
  MIN_RETENTION_DAYS,
  MIN_JOB_PROCESSOR_BATCH_SIZE,
  MIN_AUTO_TAG_MAX_PER_ARTICLE,
  MIN_SCHEDULER_JOBS_INTERVAL_MIN,
  MIN_SCHEDULER_POLL_INTERVAL_MIN,
  MIN_SCHEDULER_PULL_SLICES_PER_TICK,
  MIN_SCHEDULER_PULL_SLICE_BUDGET_MS,
  MIN_SCHEDULER_JOB_BUDGET_IDLE_MS,
  MIN_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  getFeatureModelLanes,
  getDashboardQueueConfig,
  getNewsBriefConfig,
  MAX_AUTO_READ_DELAY_MS,
  MIN_AUTO_READ_DELAY_MS,
  getAutoReadDelayMs,
  getAutoTagMaxPerArticle,
  getTaggingMethod,
  getArticleCardLayout,
  getConfiguredModelB,
  getDashboardRefreshMinMs,
  getConfiguredModelA,
  getEventsPollMs,
  getInitialFeedLookbackDays,
  getJobProcessorBatchSize,
  getSchedulerJobsIntervalMinutes,
  getSchedulerPollIntervalMinutes,
  getSchedulerPullSlicesPerTick,
  getSchedulerPullSliceBudgetMs,
  getSchedulerJobBudgetIdleMs,
  getSchedulerJobBudgetWhilePullMs,
  getSchedulerAutoQueueTodayMissing,
  getMaxFeedsPerPoll,
  getMaxItemsPerPoll,
  getRetentionConfig,
  getScorePromptConfig,
  getSetting,
  getScoringMethod,
  getScoringAiEnhancementThreshold,
  getScoringLearningRate,
  getBrowserScrapingEnabled,
  getBrowserScrapeProvider,
  DEFAULT_SCORING_METHOD,
  DEFAULT_SCORING_AI_ENHANCEMENT_THRESHOLD,
  DEFAULT_SCORING_LEARNING_RATE,
  type SettingsCache
} from '$lib/server/settings';
import { ensurePreferenceProfile } from '$lib/server/profile';
import { listApiKeys } from '$lib/server/api-keys';
import { listOAuthClientSummaries } from '$lib/server/oauth/storage';
import {
  countOrphanArticles,
  listOrphanArticleIds,
  ORPHAN_PREVIEW_SAMPLE_SIZE,
  DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT
} from '$lib/server/orphan-cleanup';

export const load = async ({ locals }) => {
  const userId = locals.user?.id ?? 'admin';
  const db = locals.db;
  const cache = locals.settingsCache;
  const featureLanes = await getFeatureModelLanes(db, cache);
  const modelA = await getConfiguredModelA(db, locals.env, cache);
  const modelB = await getConfiguredModelB(db, locals.env, cache);
  const scorePrompt = await getScorePromptConfig(db, cache);
  const dashboardQueue = await getDashboardQueueConfig(db, cache);
  const newsBrief = await getNewsBriefConfig(db, cache);
  const retention = await getRetentionConfig(db, cache);
  const taggingMethod = await getTaggingMethod(db, cache);
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
    summaryStyle: (await getSetting(db, 'summary_style', cache)) ?? 'concise',
    summaryLength: (await getSetting(db, 'summary_length', cache)) ?? 'short',
    initialFeedLookbackDays: await getInitialFeedLookbackDays(db, cache),
    maxFeedsPerPoll: await getMaxFeedsPerPoll(db, locals.env, cache),
    maxItemsPerPoll: await getMaxItemsPerPoll(db, locals.env, cache),
    eventsPollMs: await getEventsPollMs(db, locals.env, cache),
    dashboardRefreshMinMs: await getDashboardRefreshMinMs(db, locals.env, cache),
    retentionDays: retention.days,
    retentionMode: retention.mode,
    retentionArchiveDays: retention.archiveDays,
    retentionDeleteDays: retention.deleteDays,
    autoReadDelayMs: await getAutoReadDelayMs(db, cache),
    taggingMethod,
    autoTaggingEnabled: taggingMethod === 'hybrid',
    autoTagMaxPerArticle: await getAutoTagMaxPerArticle(db, cache),
    jobProcessorBatchSize: await getJobProcessorBatchSize(db, locals.env, cache),
    jobsIntervalMinutes: await getSchedulerJobsIntervalMinutes(db, cache),
    pollIntervalMinutes: await getSchedulerPollIntervalMinutes(db, cache),
    pullSlicesPerTick: await getSchedulerPullSlicesPerTick(db, cache),
    pullSliceBudgetMs: await getSchedulerPullSliceBudgetMs(db, cache),
    jobBudgetIdleMs: await getSchedulerJobBudgetIdleMs(db, cache),
    jobBudgetWhilePullMs: await getSchedulerJobBudgetWhilePullMs(db, cache),
    autoQueueTodayMissing: await getSchedulerAutoQueueTodayMissing(db, cache),
    articleCardLayout: await getArticleCardLayout(db, cache),
    dashboardQueueWindowDays: dashboardQueue.windowDays,
    dashboardQueueLimit: dashboardQueue.limit,
    dashboardQueueScoreCutoff: dashboardQueue.scoreCutoff,
    newsBriefEnabled: newsBrief.enabled,
    newsBriefTimezone: newsBrief.timezone,
    newsBriefMorningTime: newsBrief.morningTime,
    newsBriefEveningTime: newsBrief.eveningTime,
    newsBriefLookbackHours: newsBrief.lookbackHours,
    newsBriefScoreCutoff: newsBrief.scoreCutoff,
    scoringMethod: await getScoringMethod(db, cache),
    scoringAiEnhancementThreshold: await getScoringAiEnhancementThreshold(db, cache),
    scoringLearningRate: await getScoringLearningRate(db, cache),
    browserScrapingEnabled: await getBrowserScrapingEnabled(db, cache),
    browserScrapeProvider: await getBrowserScrapeProvider(db, cache),
    browserScrapeApiUrl: (await getSetting(db, 'browser_scrape_api_url', cache)) ?? ''
  };

  const [
    keys,
    profile,
    signalWeights,
    scoringObservability,
    orphanCount,
    orphanSampleIds,
    newsBriefLatestEdition,
    newsBriefTimezoneExplicit,
    connectedApps,
    apiKeys
  ] = await Promise.all([
    dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys'),
    ensurePreferenceProfile(db),
    loadSignalWeights(db),
    getScoringObservabilitySummary(db),
    countOrphanArticles(db),
    listOrphanArticleIds(db, ORPHAN_PREVIEW_SAMPLE_SIZE),
    getLatestNewsBriefEditionSummary(db, userId),
    getSetting(db, 'news_brief_timezone', cache),
    listOAuthClientSummaries(db),
    listApiKeys(db)
  ]);
  const keyMap: Record<string, boolean> = { openai: false, anthropic: false, browser_scrape: false };
  for (const key of keys) {
    if (key.provider in keyMap) keyMap[key.provider] = true;
  }

  const scorePromptDefaults = {
    scoreSystemPrompt: DEFAULT_SCORE_SYSTEM_PROMPT,
    scoreUserPromptTemplate: DEFAULT_SCORE_USER_PROMPT_TEMPLATE
  };

  return {
    settings,
    keyMap,
    profile,
    scorePromptDefaults,
    initialFeedLookbackRange: {
      min: MIN_INITIAL_FEED_LOOKBACK_DAYS,
      max: MAX_INITIAL_FEED_LOOKBACK_DAYS,
      default: DEFAULT_INITIAL_FEED_LOOKBACK_DAYS
    },
    feedPollingRange: {
      maxFeedsPerPoll: {
        min: MIN_MAX_FEEDS_PER_POLL,
        max: MAX_MAX_FEEDS_PER_POLL,
        default: DEFAULT_MAX_FEEDS_PER_POLL
      },
      maxItemsPerPoll: {
        min: MIN_MAX_ITEMS_PER_POLL,
        max: MAX_MAX_ITEMS_PER_POLL,
        default: DEFAULT_MAX_ITEMS_PER_POLL
      },
      eventsPollMs: {
        min: MIN_EVENTS_POLL_MS,
        max: MAX_EVENTS_POLL_MS,
        default: DEFAULT_EVENTS_POLL_MS
      },
      dashboardRefreshMinMs: {
        min: MIN_DASHBOARD_REFRESH_MIN_MS,
        max: MAX_DASHBOARD_REFRESH_MIN_MS,
        default: DEFAULT_DASHBOARD_REFRESH_MIN_MS
      }
    },
    retentionRange: {
      min: MIN_RETENTION_DAYS,
      max: MAX_RETENTION_DAYS,
      default: DEFAULT_RETENTION_DAYS
    },
    autoReadDelayRange: { min: MIN_AUTO_READ_DELAY_MS, max: MAX_AUTO_READ_DELAY_MS },
    jobProcessorBatchRange: {
      min: MIN_JOB_PROCESSOR_BATCH_SIZE,
      max: MAX_JOB_PROCESSOR_BATCH_SIZE,
      default: DEFAULT_JOB_PROCESSOR_BATCH_SIZE
    },
    schedulerRange: {
      jobsIntervalMinutes: {
        min: MIN_SCHEDULER_JOBS_INTERVAL_MIN,
        max: MAX_SCHEDULER_JOBS_INTERVAL_MIN,
        default: DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN
      },
      pollIntervalMinutes: {
        min: MIN_SCHEDULER_POLL_INTERVAL_MIN,
        max: MAX_SCHEDULER_POLL_INTERVAL_MIN,
        default: DEFAULT_SCHEDULER_POLL_INTERVAL_MIN
      },
      pullSlicesPerTick: {
        min: MIN_SCHEDULER_PULL_SLICES_PER_TICK,
        max: MAX_SCHEDULER_PULL_SLICES_PER_TICK,
        default: DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK
      },
      pullSliceBudgetMs: {
        min: MIN_SCHEDULER_PULL_SLICE_BUDGET_MS,
        max: MAX_SCHEDULER_PULL_SLICE_BUDGET_MS,
        default: DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS
      },
      jobBudgetIdleMs: {
        min: MIN_SCHEDULER_JOB_BUDGET_IDLE_MS,
        max: MAX_SCHEDULER_JOB_BUDGET_IDLE_MS,
        default: DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS
      },
      jobBudgetWhilePullMs: {
        min: MIN_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
        max: MAX_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
        default: DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS
      },
      autoQueueTodayMissingDefault: DEFAULT_SCHEDULER_AUTO_QUEUE_TODAY_MISSING
    },
    autoTagging: {
      default: DEFAULT_AUTO_TAGGING_ENABLED,
      maxPerArticle: {
        min: MIN_AUTO_TAG_MAX_PER_ARTICLE,
        max: MAX_AUTO_TAG_MAX_PER_ARTICLE,
        default: DEFAULT_AUTO_TAG_MAX_PER_ARTICLE
      }
    },
    dashboardQueueRange: {
      windowDays: {
        min: MIN_DASHBOARD_QUEUE_WINDOW_DAYS,
        max: MAX_DASHBOARD_QUEUE_WINDOW_DAYS,
        default: DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS
      },
      limit: {
        min: MIN_DASHBOARD_QUEUE_LIMIT,
        max: MAX_DASHBOARD_QUEUE_LIMIT,
        default: DEFAULT_DASHBOARD_QUEUE_LIMIT
      },
      scoreCutoff: {
        min: MIN_DASHBOARD_QUEUE_SCORE_CUTOFF,
        max: MAX_DASHBOARD_QUEUE_SCORE_CUTOFF,
        default: DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF
      }
    },
    newsBriefRange: {
      enabledDefault: DEFAULT_NEWS_BRIEF_ENABLED,
      timezoneDefault: DEFAULT_NEWS_BRIEF_TIMEZONE,
      morningTimeDefault: DEFAULT_NEWS_BRIEF_MORNING_TIME,
      eveningTimeDefault: DEFAULT_NEWS_BRIEF_EVENING_TIME,
      lookbackHours: {
        min: MIN_NEWS_BRIEF_LOOKBACK_HOURS,
        max: MAX_NEWS_BRIEF_LOOKBACK_HOURS,
        default: DEFAULT_NEWS_BRIEF_LOOKBACK_HOURS
      },
      scoreCutoff: {
        min: MIN_NEWS_BRIEF_SCORE_CUTOFF,
        max: MAX_NEWS_BRIEF_SCORE_CUTOFF,
        default: DEFAULT_NEWS_BRIEF_SCORE_CUTOFF
      }
    },
    newsBriefMeta: {
      timezoneExplicit: Boolean(newsBriefTimezoneExplicit)
    },
    newsBriefLatestEdition,
    connectedApps,
    orphanCleanup: {
      orphanCount,
      sampleArticleIds: orphanSampleIds,
      suggestedBatchSize: DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT
    },
    scoring: {
      signalWeights: signalWeights.map((w) => ({
        name: w.signalName,
        weight: w.weight,
        sampleCount: w.sampleCount
      })),
      defaults: {
        method: DEFAULT_SCORING_METHOD,
        aiEnhancementThreshold: DEFAULT_SCORING_AI_ENHANCEMENT_THRESHOLD,
        learningRate: DEFAULT_SCORING_LEARNING_RATE
      }
    },
    scoringObservability,
    apiKeys
  };
};
