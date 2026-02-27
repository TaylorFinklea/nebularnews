import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, type Db } from './db';
import { decryptString, encryptString } from './crypto';
import {
  DEFAULT_SCORE_SYSTEM_PROMPT,
  DEFAULT_SCORE_USER_PROMPT_TEMPLATE,
  type Provider,
  type ScorePromptConfig
} from './llm';
import { now } from './db';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type SummaryStyle = 'concise' | 'detailed' | 'bullet';
export type SummaryLength = 'short' | 'medium' | 'long';
export type AiModelLane = 'pipeline' | 'chat';
export type ArticleCardLayout = 'split' | 'stacked';
export type DashboardTopRatedLayout = 'split' | 'stacked';
export type RetentionMode = 'archive' | 'delete';
export type AiFeature =
  | 'summaries'
  | 'scoring'
  | 'profile_refresh'
  | 'key_points'
  | 'auto_tagging'
  | 'article_chat'
  | 'global_chat';

const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';
const DEFAULT_PROVIDER: Provider = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_SUMMARY_STYLE: SummaryStyle = 'concise';
const DEFAULT_SUMMARY_LENGTH: SummaryLength = 'short';
const DEFAULT_AI_MODEL_LANE: AiModelLane = 'pipeline';
const DEFAULT_ARTICLE_CARD_LAYOUT: ArticleCardLayout = 'split';
const DEFAULT_DASHBOARD_TOP_RATED_LAYOUT: DashboardTopRatedLayout = 'stacked';
const DEFAULT_AUTO_READ_DELAY_MS = 4000;
const MIN_AUTO_READ_DELAY_MS = 0;
const MAX_AUTO_READ_DELAY_MS = 30000;
const DEFAULT_DASHBOARD_TOP_RATED_CUTOFF = 3;
const MIN_DASHBOARD_TOP_RATED_CUTOFF = 1;
const MAX_DASHBOARD_TOP_RATED_CUTOFF = 5;
const DEFAULT_DASHBOARD_TOP_RATED_LIMIT = 5;
const MIN_DASHBOARD_TOP_RATED_LIMIT = 1;
const MAX_DASHBOARD_TOP_RATED_LIMIT = 20;
const DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS = 7;
const MIN_DASHBOARD_QUEUE_WINDOW_DAYS = 1;
const MAX_DASHBOARD_QUEUE_WINDOW_DAYS = 30;
const DEFAULT_DASHBOARD_QUEUE_LIMIT = 6;
const MIN_DASHBOARD_QUEUE_LIMIT = 1;
const MAX_DASHBOARD_QUEUE_LIMIT = 20;
const DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF = 3;
const MIN_DASHBOARD_QUEUE_SCORE_CUTOFF = 1;
const MAX_DASHBOARD_QUEUE_SCORE_CUTOFF = 5;
const DEFAULT_INITIAL_FEED_LOOKBACK_DAYS = 45;
const MIN_INITIAL_FEED_LOOKBACK_DAYS = 0;
const MAX_INITIAL_FEED_LOOKBACK_DAYS = 3650;
const DEFAULT_MAX_FEEDS_PER_POLL = 12;
const MIN_MAX_FEEDS_PER_POLL = 1;
const MAX_MAX_FEEDS_PER_POLL = 100;
const DEFAULT_MAX_ITEMS_PER_POLL = 120;
const MIN_MAX_ITEMS_PER_POLL = 10;
const MAX_MAX_ITEMS_PER_POLL = 2000;
const DEFAULT_EVENTS_POLL_MS = 15000;
const MIN_EVENTS_POLL_MS = 5000;
const MAX_EVENTS_POLL_MS = 60000;
const DEFAULT_DASHBOARD_REFRESH_MIN_MS = 30000;
const MIN_DASHBOARD_REFRESH_MIN_MS = 10000;
const MAX_DASHBOARD_REFRESH_MIN_MS = 120000;
const DEFAULT_RETENTION_DAYS = 0;
const MIN_RETENTION_DAYS = 0;
const MAX_RETENTION_DAYS = 3650;
const DEFAULT_RETENTION_MODE: RetentionMode = 'archive';
const DEFAULT_JOB_PROCESSOR_BATCH_SIZE = 6;
const MIN_JOB_PROCESSOR_BATCH_SIZE = 1;
const MAX_JOB_PROCESSOR_BATCH_SIZE = 100;
const DEFAULT_AUTO_TAGGING_ENABLED = true;
const DEFAULT_AUTO_TAG_MAX_PER_ARTICLE = 2;
const MIN_AUTO_TAG_MAX_PER_ARTICLE = 1;
const MAX_AUTO_TAG_MAX_PER_ARTICLE = 5;
const DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN = 5;
const MIN_SCHEDULER_JOBS_INTERVAL_MIN = 1;
const MAX_SCHEDULER_JOBS_INTERVAL_MIN = 30;
const DEFAULT_SCHEDULER_POLL_INTERVAL_MIN = 60;
const MIN_SCHEDULER_POLL_INTERVAL_MIN = 5;
const MAX_SCHEDULER_POLL_INTERVAL_MIN = 60;
const DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK = 1;
const MIN_SCHEDULER_PULL_SLICES_PER_TICK = 1;
const MAX_SCHEDULER_PULL_SLICES_PER_TICK = 4;
const DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS = 8000;
const MIN_SCHEDULER_PULL_SLICE_BUDGET_MS = 2000;
const MAX_SCHEDULER_PULL_SLICE_BUDGET_MS = 20000;
const DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS = 8000;
const MIN_SCHEDULER_JOB_BUDGET_IDLE_MS = 2000;
const MAX_SCHEDULER_JOB_BUDGET_IDLE_MS = 20000;
const DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS = 3000;
const MIN_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS = 500;
const MAX_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS = 10000;
const DEFAULT_SCHEDULER_AUTO_QUEUE_TODAY_MISSING = true;
const FEATURE_LANE_DEFAULTS: Record<AiFeature, AiModelLane> = {
  summaries: 'pipeline',
  scoring: 'pipeline',
  profile_refresh: 'pipeline',
  key_points: 'pipeline',
  auto_tagging: 'pipeline',
  article_chat: 'chat',
  global_chat: 'chat'
};
const FEATURE_LANE_KEYS: Record<AiFeature, string> = {
  summaries: 'lane_summaries',
  scoring: 'lane_scoring',
  profile_refresh: 'lane_profile_refresh',
  key_points: 'lane_key_points',
  auto_tagging: 'lane_auto_tagging',
  article_chat: 'lane_article_chat',
  global_chat: 'lane_global_chat'
};

export { DEFAULT_SCORE_SYSTEM_PROMPT, DEFAULT_SCORE_USER_PROMPT_TEMPLATE };
export { DEFAULT_AUTO_READ_DELAY_MS, MIN_AUTO_READ_DELAY_MS, MAX_AUTO_READ_DELAY_MS };
export {
  DEFAULT_DASHBOARD_TOP_RATED_CUTOFF,
  MIN_DASHBOARD_TOP_RATED_CUTOFF,
  MAX_DASHBOARD_TOP_RATED_CUTOFF,
  DEFAULT_DASHBOARD_TOP_RATED_LIMIT,
  MIN_DASHBOARD_TOP_RATED_LIMIT,
  MAX_DASHBOARD_TOP_RATED_LIMIT,
  DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS,
  MIN_DASHBOARD_QUEUE_WINDOW_DAYS,
  MAX_DASHBOARD_QUEUE_WINDOW_DAYS,
  DEFAULT_DASHBOARD_QUEUE_LIMIT,
  MIN_DASHBOARD_QUEUE_LIMIT,
  MAX_DASHBOARD_QUEUE_LIMIT,
  DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF,
  MIN_DASHBOARD_QUEUE_SCORE_CUTOFF,
  MAX_DASHBOARD_QUEUE_SCORE_CUTOFF,
  DEFAULT_INITIAL_FEED_LOOKBACK_DAYS,
  MIN_INITIAL_FEED_LOOKBACK_DAYS,
  MAX_INITIAL_FEED_LOOKBACK_DAYS,
  DEFAULT_MAX_FEEDS_PER_POLL,
  MIN_MAX_FEEDS_PER_POLL,
  MAX_MAX_FEEDS_PER_POLL,
  DEFAULT_MAX_ITEMS_PER_POLL,
  MIN_MAX_ITEMS_PER_POLL,
  MAX_MAX_ITEMS_PER_POLL,
  DEFAULT_EVENTS_POLL_MS,
  MIN_EVENTS_POLL_MS,
  MAX_EVENTS_POLL_MS,
  DEFAULT_DASHBOARD_REFRESH_MIN_MS,
  MIN_DASHBOARD_REFRESH_MIN_MS,
  MAX_DASHBOARD_REFRESH_MIN_MS,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  DEFAULT_JOB_PROCESSOR_BATCH_SIZE,
  MIN_JOB_PROCESSOR_BATCH_SIZE,
  MAX_JOB_PROCESSOR_BATCH_SIZE,
  DEFAULT_AUTO_TAGGING_ENABLED,
  DEFAULT_AUTO_TAG_MAX_PER_ARTICLE,
  MIN_AUTO_TAG_MAX_PER_ARTICLE,
  MAX_AUTO_TAG_MAX_PER_ARTICLE,
  DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN,
  MIN_SCHEDULER_JOBS_INTERVAL_MIN,
  MAX_SCHEDULER_JOBS_INTERVAL_MIN,
  DEFAULT_SCHEDULER_POLL_INTERVAL_MIN,
  MIN_SCHEDULER_POLL_INTERVAL_MIN,
  MAX_SCHEDULER_POLL_INTERVAL_MIN,
  DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK,
  MIN_SCHEDULER_PULL_SLICES_PER_TICK,
  MAX_SCHEDULER_PULL_SLICES_PER_TICK,
  DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS,
  MIN_SCHEDULER_PULL_SLICE_BUDGET_MS,
  MAX_SCHEDULER_PULL_SLICE_BUDGET_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS,
  MIN_SCHEDULER_JOB_BUDGET_IDLE_MS,
  MAX_SCHEDULER_JOB_BUDGET_IDLE_MS,
  DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  MIN_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  MAX_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
  DEFAULT_SCHEDULER_AUTO_QUEUE_TODAY_MISSING
};

const toReasoningEffort = (value: string | null): ReasoningEffort => {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return DEFAULT_REASONING_EFFORT;
};

const toProvider = (value: string | null): Provider => {
  if (value === 'openai' || value === 'anthropic') return value;
  return DEFAULT_PROVIDER;
};

const toSummaryStyle = (value: string | null): SummaryStyle => {
  if (value === 'concise' || value === 'detailed' || value === 'bullet') return value;
  return DEFAULT_SUMMARY_STYLE;
};

const toSummaryLength = (value: string | null): SummaryLength => {
  if (value === 'short' || value === 'medium' || value === 'long') return value;
  return DEFAULT_SUMMARY_LENGTH;
};

const toAiModelLane = (value: string | null): AiModelLane => {
  if (value === 'chat' || value === 'pipeline') return value;
  return DEFAULT_AI_MODEL_LANE;
};

const toArticleCardLayout = (value: string | null): ArticleCardLayout => {
  if (value === 'split' || value === 'stacked') return value;
  return DEFAULT_ARTICLE_CARD_LAYOUT;
};

const toDashboardTopRatedLayout = (value: string | null): DashboardTopRatedLayout => {
  if (value === 'split' || value === 'stacked') return value;
  return DEFAULT_DASHBOARD_TOP_RATED_LAYOUT;
};

const toRetentionMode = (value: string | null): RetentionMode => {
  if (value === 'archive' || value === 'delete') return value;
  return DEFAULT_RETENTION_MODE;
};

export type ProviderModelConfig = {
  provider: Provider;
  model: string;
  reasoningEffort: ReasoningEffort;
};

export const clampAutoReadDelayMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_READ_DELAY_MS;
  return Math.min(MAX_AUTO_READ_DELAY_MS, Math.max(MIN_AUTO_READ_DELAY_MS, Math.round(parsed)));
};

export const clampDashboardTopRatedCutoff = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_TOP_RATED_CUTOFF;
  return Math.min(
    MAX_DASHBOARD_TOP_RATED_CUTOFF,
    Math.max(MIN_DASHBOARD_TOP_RATED_CUTOFF, Math.round(parsed))
  );
};

export const clampDashboardTopRatedLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_TOP_RATED_LIMIT;
  return Math.min(MAX_DASHBOARD_TOP_RATED_LIMIT, Math.max(MIN_DASHBOARD_TOP_RATED_LIMIT, Math.round(parsed)));
};

export const clampDashboardQueueWindowDays = (value: unknown) => {
  if (value === null || value === undefined || value === '') return DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_QUEUE_WINDOW_DAYS;
  return Math.min(
    MAX_DASHBOARD_QUEUE_WINDOW_DAYS,
    Math.max(MIN_DASHBOARD_QUEUE_WINDOW_DAYS, Math.round(parsed))
  );
};

export const clampDashboardQueueLimit = (value: unknown) => {
  if (value === null || value === undefined || value === '') return DEFAULT_DASHBOARD_QUEUE_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_QUEUE_LIMIT;
  return Math.min(MAX_DASHBOARD_QUEUE_LIMIT, Math.max(MIN_DASHBOARD_QUEUE_LIMIT, Math.round(parsed)));
};

export const clampDashboardQueueScoreCutoff = (value: unknown) => {
  if (value === null || value === undefined || value === '') return DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_QUEUE_SCORE_CUTOFF;
  return Math.min(
    MAX_DASHBOARD_QUEUE_SCORE_CUTOFF,
    Math.max(MIN_DASHBOARD_QUEUE_SCORE_CUTOFF, Math.round(parsed))
  );
};

export const clampInitialFeedLookbackDays = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INITIAL_FEED_LOOKBACK_DAYS;
  return Math.min(
    MAX_INITIAL_FEED_LOOKBACK_DAYS,
    Math.max(MIN_INITIAL_FEED_LOOKBACK_DAYS, Math.round(parsed))
  );
};

export const clampRetentionDays = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.round(parsed)));
};

export const clampMaxFeedsPerPoll = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_FEEDS_PER_POLL;
  return Math.min(MAX_MAX_FEEDS_PER_POLL, Math.max(MIN_MAX_FEEDS_PER_POLL, Math.round(parsed)));
};

export const clampMaxItemsPerPoll = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ITEMS_PER_POLL;
  return Math.min(MAX_MAX_ITEMS_PER_POLL, Math.max(MIN_MAX_ITEMS_PER_POLL, Math.round(parsed)));
};

export const clampEventsPollMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_EVENTS_POLL_MS;
  return Math.min(MAX_EVENTS_POLL_MS, Math.max(MIN_EVENTS_POLL_MS, Math.round(parsed)));
};

export const clampDashboardRefreshMinMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_REFRESH_MIN_MS;
  return Math.min(
    MAX_DASHBOARD_REFRESH_MIN_MS,
    Math.max(MIN_DASHBOARD_REFRESH_MIN_MS, Math.round(parsed))
  );
};

export const clampJobProcessorBatchSize = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_JOB_PROCESSOR_BATCH_SIZE;
  return Math.min(
    MAX_JOB_PROCESSOR_BATCH_SIZE,
    Math.max(MIN_JOB_PROCESSOR_BATCH_SIZE, Math.round(parsed))
  );
};

export const clampAutoTagMaxPerArticle = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_TAG_MAX_PER_ARTICLE;
  return Math.min(
    MAX_AUTO_TAG_MAX_PER_ARTICLE,
    Math.max(MIN_AUTO_TAG_MAX_PER_ARTICLE, Math.round(parsed))
  );
};

export const clampSchedulerJobsIntervalMinutes = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULER_JOBS_INTERVAL_MIN;
  return Math.min(
    MAX_SCHEDULER_JOBS_INTERVAL_MIN,
    Math.max(MIN_SCHEDULER_JOBS_INTERVAL_MIN, Math.round(parsed))
  );
};

export const clampSchedulerPollIntervalMinutes = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULER_POLL_INTERVAL_MIN;
  return Math.min(
    MAX_SCHEDULER_POLL_INTERVAL_MIN,
    Math.max(MIN_SCHEDULER_POLL_INTERVAL_MIN, Math.round(parsed))
  );
};

export const clampSchedulerPullSlicesPerTick = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULER_PULL_SLICES_PER_TICK;
  return Math.min(
    MAX_SCHEDULER_PULL_SLICES_PER_TICK,
    Math.max(MIN_SCHEDULER_PULL_SLICES_PER_TICK, Math.round(parsed))
  );
};

export const clampSchedulerPullSliceBudgetMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULER_PULL_SLICE_BUDGET_MS;
  return Math.min(
    MAX_SCHEDULER_PULL_SLICE_BUDGET_MS,
    Math.max(MIN_SCHEDULER_PULL_SLICE_BUDGET_MS, Math.round(parsed))
  );
};

export const clampSchedulerJobBudgetIdleMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULER_JOB_BUDGET_IDLE_MS;
  return Math.min(
    MAX_SCHEDULER_JOB_BUDGET_IDLE_MS,
    Math.max(MIN_SCHEDULER_JOB_BUDGET_IDLE_MS, Math.round(parsed))
  );
};

export const clampSchedulerJobBudgetWhilePullMs = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS;
  return Math.min(
    MAX_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS,
    Math.max(MIN_SCHEDULER_JOB_BUDGET_WHILE_PULL_MS, Math.round(parsed))
  );
};

export const parseBooleanSetting = (value: unknown, fallback: boolean) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

export const intervalMinutesToCronExpression = (minutes: number) => {
  const value = Math.max(1, Math.floor(Number(minutes) || 1));
  if (value >= 60) return '0 * * * *';
  return `*/${value} * * * *`;
};

const getFirstSetting = async (db: Db, keys: string[]) => {
  for (const key of keys) {
    const value = await getSetting(db, key);
    if (value) return value;
  }
  return null;
};

export async function getSetting(db: Db, key: string) {
  const row = await dbGet<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string) {
  const existing = await dbGet<{ id: string }>(db, 'SELECT id FROM settings WHERE key = ?', [key]);
  if (existing) {
    await dbRun(db, 'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [value, now(), key]);
  } else {
    await dbRun(
      db,
      'INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)',
      [nanoid(), key, value, now()]
    );
  }
}

export async function getProviderModel(db: Db, env: App.Platform['env']) {
  return getIngestProviderModel(db, env);
}

async function resolveIngestProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  const provider = toProvider(
    (await getFirstSetting(db, ['ingest_provider', 'default_provider'])) ??
      env.DEFAULT_INGEST_PROVIDER ??
      env.DEFAULT_PROVIDER ??
      null
  );
  const model =
    (await getFirstSetting(db, ['ingest_model', 'default_model'])) ??
    env.DEFAULT_INGEST_MODEL ??
    env.DEFAULT_MODEL ??
    DEFAULT_MODEL;
  const reasoningEffort = toReasoningEffort(
    (await getFirstSetting(db, ['ingest_reasoning_effort', 'reasoning_effort'])) ??
      env.DEFAULT_INGEST_REASONING_EFFORT ??
      env.DEFAULT_REASONING_EFFORT ??
      null
  );

  return { provider, model, reasoningEffort };
}

async function resolveChatProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  const provider = toProvider(
    (await getFirstSetting(db, ['chat_provider', 'default_provider'])) ??
      env.DEFAULT_CHAT_PROVIDER ??
      env.DEFAULT_PROVIDER ??
      null
  );
  const model =
    (await getFirstSetting(db, ['chat_model', 'default_model'])) ??
    env.DEFAULT_CHAT_MODEL ??
    env.DEFAULT_MODEL ??
    DEFAULT_MODEL;
  const reasoningEffort = toReasoningEffort(
    (await getFirstSetting(db, ['chat_reasoning_effort', 'reasoning_effort'])) ??
      env.DEFAULT_CHAT_REASONING_EFFORT ??
      env.DEFAULT_REASONING_EFFORT ??
      null
  );

  return { provider, model, reasoningEffort };
}

export async function getConfiguredIngestProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  return resolveIngestProviderModel(db, env);
}

export async function getConfiguredChatProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  return resolveChatProviderModel(db, env);
}

export async function getFeatureModelLane(db: Db, feature: AiFeature): Promise<AiModelLane> {
  const key = FEATURE_LANE_KEYS[feature];
  const raw = await getSetting(db, key);
  if (raw) return toAiModelLane(raw);
  const legacyGlobalLane = await getSetting(db, 'ai_model_lane');
  if (legacyGlobalLane) return toAiModelLane(legacyGlobalLane);
  return FEATURE_LANE_DEFAULTS[feature];
}

export async function getFeatureModelLanes(db: Db): Promise<Record<AiFeature, AiModelLane>> {
  return {
    summaries: await getFeatureModelLane(db, 'summaries'),
    scoring: await getFeatureModelLane(db, 'scoring'),
    profile_refresh: await getFeatureModelLane(db, 'profile_refresh'),
    key_points: await getFeatureModelLane(db, 'key_points'),
    auto_tagging: await getFeatureModelLane(db, 'auto_tagging'),
    article_chat: await getFeatureModelLane(db, 'article_chat'),
    global_chat: await getFeatureModelLane(db, 'global_chat')
  };
}

export async function setFeatureModelLane(db: Db, feature: AiFeature, lane: AiModelLane) {
  await setSetting(db, FEATURE_LANE_KEYS[feature], lane);
}

export async function getFeatureProviderModel(
  db: Db,
  env: App.Platform['env'],
  feature: AiFeature
): Promise<ProviderModelConfig> {
  const lane = await getFeatureModelLane(db, feature);
  if (lane === 'chat') return resolveChatProviderModel(db, env);
  return resolveIngestProviderModel(db, env);
}

export async function getIngestProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  return resolveIngestProviderModel(db, env);
}

export async function getChatProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  return resolveChatProviderModel(db, env);
}

export async function getScorePromptConfig(db: Db): Promise<ScorePromptConfig> {
  const systemPrompt = (await getSetting(db, 'score_system_prompt')) ?? DEFAULT_SCORE_SYSTEM_PROMPT;
  const userPromptTemplate = (await getSetting(db, 'score_user_prompt_template')) ?? DEFAULT_SCORE_USER_PROMPT_TEMPLATE;
  return { systemPrompt, userPromptTemplate };
}

export async function getSummaryConfig(db: Db): Promise<{ style: SummaryStyle; length: SummaryLength }> {
  return {
    style: toSummaryStyle(await getSetting(db, 'summary_style')),
    length: toSummaryLength(await getSetting(db, 'summary_length'))
  };
}

export async function getAutoReadDelayMs(db: Db) {
  const raw = await getSetting(db, 'auto_read_delay_ms');
  return clampAutoReadDelayMs(raw);
}

export async function getDashboardTopRatedConfig(db: Db) {
  const cutoff = clampDashboardTopRatedCutoff(await getSetting(db, 'dashboard_top_rated_cutoff'));
  const limit = clampDashboardTopRatedLimit(await getSetting(db, 'dashboard_top_rated_limit'));
  return { cutoff, limit };
}

export async function getDashboardQueueConfig(db: Db) {
  const [windowDaysRaw, queueLimitRaw, queueCutoffRaw, legacyLimitRaw, legacyCutoffRaw] = await Promise.all([
    getSetting(db, 'dashboard_queue_window_days'),
    getSetting(db, 'dashboard_queue_limit'),
    getSetting(db, 'dashboard_queue_score_cutoff'),
    getSetting(db, 'dashboard_top_rated_limit'),
    getSetting(db, 'dashboard_top_rated_cutoff')
  ]);

  return {
    windowDays: clampDashboardQueueWindowDays(windowDaysRaw),
    limit: clampDashboardQueueLimit(queueLimitRaw ?? legacyLimitRaw),
    scoreCutoff: clampDashboardQueueScoreCutoff(queueCutoffRaw ?? legacyCutoffRaw)
  };
}

export async function getInitialFeedLookbackDays(db: Db) {
  const raw = await getSetting(db, 'initial_feed_lookback_days');
  return clampInitialFeedLookbackDays(raw);
}

export async function getMaxFeedsPerPoll(db: Db, env?: App.Platform['env']) {
  const raw = (await getSetting(db, 'max_feeds_per_poll')) ?? env?.MAX_FEEDS_PER_POLL ?? null;
  return clampMaxFeedsPerPoll(raw);
}

export async function getMaxItemsPerPoll(db: Db, env?: App.Platform['env']) {
  const raw = (await getSetting(db, 'max_items_per_poll')) ?? env?.MAX_ITEMS_PER_POLL ?? null;
  return clampMaxItemsPerPoll(raw);
}

export async function getEventsPollMs(db: Db, env?: App.Platform['env']) {
  const raw = (await getSetting(db, 'events_poll_ms')) ?? env?.EVENTS_POLL_MS ?? null;
  return clampEventsPollMs(raw);
}

export async function getDashboardRefreshMinMs(db: Db, env?: App.Platform['env']) {
  const raw = (await getSetting(db, 'dashboard_refresh_min_ms')) ?? env?.DASHBOARD_REFRESH_MIN_MS ?? null;
  return clampDashboardRefreshMinMs(raw);
}

export async function getRetentionConfig(db: Db) {
  const days = clampRetentionDays(await getSetting(db, 'retention_days'));
  const mode = toRetentionMode(await getSetting(db, 'retention_mode'));
  return { days, mode };
}

export async function getJobProcessorBatchSize(db: Db, env?: App.Platform['env']) {
  const raw = (await getSetting(db, 'job_processor_batch_size')) ?? env?.JOB_PROCESSOR_BATCH_SIZE ?? null;
  return clampJobProcessorBatchSize(raw);
}

export async function getAutoTaggingEnabled(db: Db) {
  const raw = await getSetting(db, 'auto_tagging_enabled');
  return parseBooleanSetting(raw, DEFAULT_AUTO_TAGGING_ENABLED);
}

export async function getAutoTagMaxPerArticle(db: Db) {
  const raw = await getSetting(db, 'auto_tag_max_per_article');
  return clampAutoTagMaxPerArticle(raw);
}

export async function getSchedulerJobsIntervalMinutes(db: Db) {
  const raw = await getSetting(db, 'scheduler_jobs_interval_min');
  return clampSchedulerJobsIntervalMinutes(raw);
}

export async function getSchedulerPollIntervalMinutes(db: Db) {
  const raw = await getSetting(db, 'scheduler_poll_interval_min');
  return clampSchedulerPollIntervalMinutes(raw);
}

export async function getSchedulerPullSlicesPerTick(db: Db) {
  const raw = await getSetting(db, 'scheduler_pull_slices_per_tick');
  return clampSchedulerPullSlicesPerTick(raw);
}

export async function getSchedulerPullSliceBudgetMs(db: Db) {
  const raw = await getSetting(db, 'scheduler_pull_slice_budget_ms');
  return clampSchedulerPullSliceBudgetMs(raw);
}

export async function getSchedulerJobBudgetIdleMs(db: Db) {
  const raw = await getSetting(db, 'scheduler_job_budget_idle_ms');
  return clampSchedulerJobBudgetIdleMs(raw);
}

export async function getSchedulerJobBudgetWhilePullMs(db: Db) {
  const raw = await getSetting(db, 'scheduler_job_budget_while_pull_ms');
  return clampSchedulerJobBudgetWhilePullMs(raw);
}

export async function getSchedulerAutoQueueTodayMissing(db: Db) {
  const raw = await getSetting(db, 'scheduler_auto_queue_today_missing');
  return parseBooleanSetting(raw, DEFAULT_SCHEDULER_AUTO_QUEUE_TODAY_MISSING);
}

export async function getSchedulerRuntimeConfig(db: Db) {
  const [
    jobsIntervalMinutes,
    pollIntervalMinutes,
    pullSlicesPerTick,
    pullSliceBudgetMs,
    jobBudgetIdleMs,
    jobBudgetWhilePullMs,
    autoQueueTodayMissing
  ] = await Promise.all([
    getSchedulerJobsIntervalMinutes(db),
    getSchedulerPollIntervalMinutes(db),
    getSchedulerPullSlicesPerTick(db),
    getSchedulerPullSliceBudgetMs(db),
    getSchedulerJobBudgetIdleMs(db),
    getSchedulerJobBudgetWhilePullMs(db),
    getSchedulerAutoQueueTodayMissing(db)
  ]);

  return {
    jobsIntervalMinutes,
    pollIntervalMinutes,
    pullSlicesPerTick,
    pullSliceBudgetMs,
    jobBudgetIdleMs,
    jobBudgetWhilePullMs,
    autoQueueTodayMissing
  };
}

export async function getDashboardTopRatedLayout(db: Db): Promise<DashboardTopRatedLayout> {
  return toDashboardTopRatedLayout(await getSetting(db, 'dashboard_top_rated_layout'));
}

export async function getArticleCardLayout(db: Db): Promise<ArticleCardLayout> {
  return toArticleCardLayout(await getSetting(db, 'article_card_layout'));
}

export async function getProviderKey(db: Db, env: App.Platform['env'], provider: Provider) {
  const row = await dbGet<{ encrypted_key: string }>(db, 'SELECT encrypted_key FROM provider_keys WHERE provider = ?', [
    provider
  ]);
  if (!row) return null;
  return decryptString(row.encrypted_key, env.ENCRYPTION_KEY);
}

export async function setProviderKey(db: Db, env: App.Platform['env'], provider: Provider, apiKey: string) {
  const encrypted = await encryptString(apiKey, env.ENCRYPTION_KEY);
  const existing = await dbGet<{ id: string }>(db, 'SELECT id FROM provider_keys WHERE provider = ?', [provider]);
  if (existing) {
    await dbRun(
      db,
      'UPDATE provider_keys SET encrypted_key = ?, key_version = key_version + 1, last_used_at = ?, status = ? WHERE provider = ?',
      [encrypted, now(), 'active', provider]
    );
  } else {
    await dbRun(
      db,
      'INSERT INTO provider_keys (id, provider, encrypted_key, key_version, created_at, last_used_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nanoid(), provider, encrypted, 1, now(), now(), 'active']
    );
  }
}

export async function deleteProviderKey(db: Db, provider: Provider) {
  await dbRun(db, 'DELETE FROM provider_keys WHERE provider = ?', [provider]);
}

export async function rotateProviderKeyEncryption(db: Db, env: App.Platform['env'], provider?: Provider) {
  const where = provider ? 'WHERE provider = ?' : '';
  const params = provider ? [provider] : [];
  const rows = await dbAll<{ provider: Provider; encrypted_key: string }>(
    db,
    `SELECT provider, encrypted_key FROM provider_keys ${where}`,
    params
  );
  let rotated = 0;

  for (const row of rows) {
    const plaintext = await decryptString(row.encrypted_key, env.ENCRYPTION_KEY);
    const encrypted = await encryptString(plaintext, env.ENCRYPTION_KEY);
    await dbRun(
      db,
      `UPDATE provider_keys
       SET encrypted_key = ?,
           key_version = key_version + 1,
           last_used_at = ?,
           status = ?
       WHERE provider = ?`,
      [encrypted, now(), 'active', row.provider]
    );
    rotated += 1;
  }

  return rotated;
}
