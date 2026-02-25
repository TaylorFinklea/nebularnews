import { dbAll } from '$lib/server/db';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  DEFAULT_DASHBOARD_TOP_RATED_CUTOFF,
  DEFAULT_DASHBOARD_TOP_RATED_LIMIT,
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
  MAX_DASHBOARD_TOP_RATED_CUTOFF,
  MAX_DASHBOARD_TOP_RATED_LIMIT,
  MAX_DASHBOARD_REFRESH_MIN_MS,
  MAX_EVENTS_POLL_MS,
  MAX_INITIAL_FEED_LOOKBACK_DAYS,
  MAX_MAX_FEEDS_PER_POLL,
  MAX_MAX_ITEMS_PER_POLL,
  MAX_RETENTION_DAYS,
  MAX_JOB_PROCESSOR_BATCH_SIZE,
  MAX_SCHEDULER_JOBS_INTERVAL_MIN,
  MAX_SCHEDULER_POLL_INTERVAL_MIN,
  MAX_SCHEDULER_PULL_SLICES_PER_TICK,
  MAX_SCHEDULER_PULL_SLICE_BUDGET_MS,
  MAX_SCHEDULER_JOB_BUDGET_IDLE_MS,
  MAX_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  MIN_DASHBOARD_TOP_RATED_CUTOFF,
  MIN_DASHBOARD_TOP_RATED_LIMIT,
  MIN_DASHBOARD_REFRESH_MIN_MS,
  MIN_EVENTS_POLL_MS,
  MIN_INITIAL_FEED_LOOKBACK_DAYS,
  MIN_MAX_FEEDS_PER_POLL,
  MIN_MAX_ITEMS_PER_POLL,
  MIN_RETENTION_DAYS,
  MIN_JOB_PROCESSOR_BATCH_SIZE,
  MIN_SCHEDULER_JOBS_INTERVAL_MIN,
  MIN_SCHEDULER_POLL_INTERVAL_MIN,
  MIN_SCHEDULER_PULL_SLICES_PER_TICK,
  MIN_SCHEDULER_PULL_SLICE_BUDGET_MS,
  MIN_SCHEDULER_JOB_BUDGET_IDLE_MS,
  MIN_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  getFeatureModelLanes,
  getDashboardTopRatedConfig,
  MAX_AUTO_READ_DELAY_MS,
  MIN_AUTO_READ_DELAY_MS,
  getAutoReadDelayMs,
  getArticleCardLayout,
  getDashboardTopRatedLayout,
  getConfiguredChatProviderModel,
  getDashboardRefreshMinMs,
  getConfiguredIngestProviderModel,
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
  getSetting
} from '$lib/server/settings';
import { ensurePreferenceProfile } from '$lib/server/profile';

export const load = async ({ platform }) => {
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
    initialFeedLookbackDays: await getInitialFeedLookbackDays(db),
    maxFeedsPerPoll: await getMaxFeedsPerPoll(db, platform.env),
    maxItemsPerPoll: await getMaxItemsPerPoll(db, platform.env),
    eventsPollMs: await getEventsPollMs(db, platform.env),
    dashboardRefreshMinMs: await getDashboardRefreshMinMs(db, platform.env),
    retentionDays: retention.days,
    retentionMode: retention.mode,
    autoReadDelayMs: await getAutoReadDelayMs(db),
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

  const profile = await ensurePreferenceProfile(db);

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
    dashboardTopRatedRange: {
      cutoff: {
        min: MIN_DASHBOARD_TOP_RATED_CUTOFF,
        max: MAX_DASHBOARD_TOP_RATED_CUTOFF,
        default: DEFAULT_DASHBOARD_TOP_RATED_CUTOFF
      },
      limit: {
        min: MIN_DASHBOARD_TOP_RATED_LIMIT,
        max: MAX_DASHBOARD_TOP_RATED_LIMIT,
        default: DEFAULT_DASHBOARD_TOP_RATED_LIMIT
      }
    }
  };
};
