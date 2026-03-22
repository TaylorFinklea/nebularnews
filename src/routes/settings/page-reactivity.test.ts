// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './+page.svelte';

const invalidateAllMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$app/navigation', () => ({
  invalidateAll: invalidateAllMock
}));

const createData = (overrides = {}) => ({
  settings: {
    featureLanes: {
      summaries: 'model_a',
      scoring: 'model_a',
      profileRefresh: 'model_a',
      keyPoints: 'model_a',
      autoTagging: 'model_a'
    },
    modelAProvider: 'openai',
    modelAModel: 'gpt-4o-mini',
    modelAReasoningEffort: 'low',
    modelBProvider: 'openai',
    modelBModel: 'gpt-4o',
    modelBReasoningEffort: 'medium',
    scoreSystemPrompt: 'Default system prompt',
    scoreUserPromptTemplate: 'Default user prompt',
    summaryStyle: 'concise',
    summaryLength: 'short',
    scoringMethod: 'hybrid',
    initialFeedLookbackDays: 45,
    maxFeedsPerPoll: 12,
    maxItemsPerPoll: 120,
    eventsPollMs: 15000,
    dashboardRefreshMinMs: 30000,
    retentionDays: 0,
    retentionArchiveDays: 30,
    retentionDeleteDays: 90,
    retentionMode: 'archive',
    autoReadDelayMs: 4000,
    taggingMethod: 'hybrid',
    autoTaggingEnabled: true,
    autoTagMaxPerArticle: 2,
    jobProcessorBatchSize: 6,
    jobsIntervalMinutes: 5,
    pollIntervalMinutes: 60,
    pullSlicesPerTick: 1,
    pullSliceBudgetMs: 8000,
    jobBudgetIdleMs: 8000,
    jobBudgetWhilePullMs: 3000,
    autoQueueTodayMissing: true,
    articleCardLayout: 'split',
    dashboardQueueWindowDays: 7,
    dashboardQueueLimit: 6,
    dashboardQueueScoreCutoff: 3,
    newsBriefEnabled: true,
    newsBriefTimezone: 'America/Chicago',
    newsBriefMorningTime: '08:00',
    newsBriefEveningTime: '17:00',
    newsBriefLookbackHours: 48,
    newsBriefScoreCutoff: 3,
    scoringAiEnhancementThreshold: 0.5
  },
  keyMap: { openai: false, anthropic: false },
  profile: {
    version: 4,
    updated_at: Date.UTC(2026, 1, 28, 18, 0, 0),
    profile_text: 'Profile text'
  },
  scorePromptDefaults: {
    scoreSystemPrompt: 'Default system prompt',
    scoreUserPromptTemplate: 'Default user prompt'
  },
  initialFeedLookbackRange: { min: 0, max: 365, default: 45 },
  feedPollingRange: {
    maxFeedsPerPoll: { min: 1, max: 50, default: 12 },
    maxItemsPerPoll: { min: 10, max: 250, default: 120 },
    eventsPollMs: { min: 1000, max: 60000, default: 15000 },
    dashboardRefreshMinMs: { min: 1000, max: 120000, default: 30000 }
  },
  retentionRange: { min: 0, max: 365, default: 0 },
  autoReadDelayRange: { min: 0, max: 60000 },
  autoTagging: { default: true, maxPerArticle: { min: 1, max: 5, default: 2 } },
  jobProcessorBatchRange: { min: 1, max: 20, default: 6 },
  schedulerRange: {
    jobsIntervalMinutes: { min: 1, max: 60, default: 5 },
    pollIntervalMinutes: { min: 5, max: 120, default: 60 },
    pullSlicesPerTick: { min: 1, max: 5, default: 1 },
    pullSliceBudgetMs: { min: 1000, max: 20000, default: 8000 },
    jobBudgetIdleMs: { min: 1000, max: 20000, default: 8000 },
    jobBudgetWhilePullMs: { min: 1000, max: 10000, default: 3000 },
    autoQueueTodayMissingDefault: true
  },
  dashboardQueueRange: {
    windowDays: { min: 1, max: 30, default: 7 },
    limit: { min: 1, max: 20, default: 6 },
    scoreCutoff: { min: 1, max: 5, default: 3 }
  },
  newsBriefRange: {
    enabledDefault: true,
    timezoneDefault: 'America/Chicago',
    morningTimeDefault: '08:00',
    eveningTimeDefault: '17:00',
    lookbackHours: { min: 6, max: 168, default: 48 },
    scoreCutoff: { min: 1, max: 5, default: 3 }
  },
  newsBriefMeta: { timezoneExplicit: true },
  newsBriefLatestEdition: {
    id: 'edition-1',
    status: 'ready',
    editionLabel: 'Morning edition',
    generatedAt: Date.UTC(2026, 2, 3, 14, 0, 0),
    candidateCount: 4,
    updatedAt: Date.UTC(2026, 2, 3, 14, 2, 0)
  },
  orphanCleanup: {
    orphanCount: 2,
    sampleArticleIds: ['article-1', 'article-2'],
    suggestedBatchSize: 200
  },
  scoringObservability: {
    scoreStatusCounts: { ready: 12, insufficientSignal: 5 },
    confidenceBuckets: { low: 4, medium: 8, high: 5 },
    tagSourceCounts: { manual: 7, system: 11, ai: 3 },
    recentCoverage: {
      windowDays: 30,
      recentArticles: 20,
      recentScoredArticles: 10,
      taggedArticlePercent: 75,
      preferenceBackedScorePercent: 60
    }
  },
  connectedApps: [],
  scoring: { signalWeights: [] },
  ...overrides
});

describe('Settings page reactivity', () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: {} })
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders essential settings without needing to expand anything', () => {
    render(SettingsPage, { data: createData() });

    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText(/Model A/)).toBeTruthy();
    expect(screen.getByText(/Model B/)).toBeTruthy();
  });

  it('renders the page without errors', () => {
    expect(() => render(SettingsPage, { data: createData() })).not.toThrow();
  });
});
