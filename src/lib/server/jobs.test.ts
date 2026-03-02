import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const dbAllMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const nowMock = vi.hoisted(() => vi.fn(() => 1234));
const getAutoTagMaxPerArticleMock = vi.hoisted(() => vi.fn());
const generateDeterministicTagDecisionsMock = vi.hoisted(() => vi.fn());
const applyDeterministicTagDecisionsMock = vi.hoisted(() => vi.fn());
const enqueueScoreJobMock = vi.hoisted(() => vi.fn(async () => undefined));
const logInfoMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbAll: dbAllMock,
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  now: nowMock
}));

vi.mock('./llm', () => ({
  enhanceScore: vi.fn(),
  generateArticleKeyPoints: vi.fn(),
  refreshPreferenceProfile: vi.fn(),
  scoreArticle: vi.fn(),
  summarizeArticle: vi.fn()
}));

vi.mock('./images', () => ({
  extractLeadImageUrlFromHtml: vi.fn()
}));

vi.mock('./settings', () => ({
  getAutoTagMaxPerArticle: getAutoTagMaxPerArticleMock,
  getFeatureProviderModel: vi.fn(),
  getJobProcessorBatchSize: vi.fn(),
  getProviderKey: vi.fn(),
  getScorePromptConfig: vi.fn(),
  getScoringMethod: vi.fn(),
  getScoringAiEnhancementThreshold: vi.fn(),
  getSummaryConfig: vi.fn()
}));

vi.mock('./profile', () => ({
  ensurePreferenceProfile: vi.fn()
}));

vi.mock('./scoring/engine', () => ({
  scoreArticleAlgorithmic: vi.fn()
}));

vi.mock('./tagging/rules', () => ({
  generateDeterministicTagDecisions: generateDeterministicTagDecisionsMock,
  applyDeterministicTagDecisions: applyDeterministicTagDecisionsMock
}));

vi.mock('./job-queue', () => ({
  enqueueScoreJob: enqueueScoreJobMock
}));

vi.mock('./log', () => ({
  logInfo: logInfoMock
}));

vi.mock('./flags', () => ({
  isJobBatchV2Enabled: vi.fn(() => false)
}));

import { runAutoTagJob } from './jobs';

describe('runAutoTagJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAutoTagMaxPerArticleMock.mockResolvedValue(3);
    dbGetMock.mockResolvedValue({
      title: 'AI policy shifts',
      canonical_url: 'https://example.com/ai-policy',
      content_text: null,
      source_feed_id: 'feed-1'
    });
    generateDeterministicTagDecisionsMock.mockResolvedValue([
      { tagId: 'tag-1', score: 1, confidence: 1, features: ['title_phrase'] }
    ]);
  });

  it('succeeds without a provider key and enqueues rescoring when system tags change', async () => {
    applyDeterministicTagDecisionsMock.mockResolvedValue({
      changed: true,
      beforeState: '',
      afterState: 'tag-1:system:1.000',
      attachedTagIds: ['tag-1'],
      updatedTagIds: [],
      removedTagIds: [],
      skippedExistingTagIds: []
    });

    const result = await runAutoTagJob(
      {} as D1Database,
      {
        DB: {} as D1Database
      } as App.Platform['env'],
      'article-1'
    );

    expect(result).toBeNull();
    expect(getAutoTagMaxPerArticleMock).toHaveBeenCalledWith(expect.anything());
    expect(generateDeterministicTagDecisionsMock).toHaveBeenCalledWith(expect.anything(), {
      articleId: 'article-1',
      title: 'AI policy shifts',
      canonicalUrl: 'https://example.com/ai-policy',
      contentText: null,
      sourceFeedId: 'feed-1',
      maxTags: 3
    });
    expect(enqueueScoreJobMock).toHaveBeenCalledWith(expect.anything(), 'article-1');
  });

  it('does not enqueue rescoring when deterministic tags are unchanged', async () => {
    applyDeterministicTagDecisionsMock.mockResolvedValue({
      changed: false,
      beforeState: 'tag-1:system:1.000',
      afterState: 'tag-1:system:1.000',
      attachedTagIds: [],
      updatedTagIds: [],
      removedTagIds: [],
      skippedExistingTagIds: []
    });

    await runAutoTagJob(
      {} as D1Database,
      {
        DB: {} as D1Database
      } as App.Platform['env'],
      'article-1'
    );

    expect(enqueueScoreJobMock).not.toHaveBeenCalled();
  });
});
