import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());
const dbAllMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const nowMock = vi.hoisted(() => vi.fn(() => 1234));
const getAutoTagMaxPerArticleMock = vi.hoisted(() => vi.fn());
const getScoringMethodMock = vi.hoisted(() => vi.fn());
const getTaggingMethodMock = vi.hoisted(() => vi.fn());
const generateDeterministicTagDecisionsMock = vi.hoisted(() => vi.fn());
const generateArticleTagDecisionsMock = vi.hoisted(() => vi.fn());
const applyDeterministicTagDecisionsMock = vi.hoisted(() => vi.fn());
const enqueueScoreJobMock = vi.hoisted(() => vi.fn(async () => undefined));
const ensurePreferenceProfileMock = vi.hoisted(() => vi.fn());
const scoreArticleAlgorithmicMock = vi.hoisted(() => vi.fn());
const getFeatureProviderModelMock = vi.hoisted(() => vi.fn());
const getProviderKeyMock = vi.hoisted(() => vi.fn());
const listExistingTagCandidatesForArticleMock = vi.hoisted(() => vi.fn());
const listDismissedSuggestionNamesForArticleMock = vi.hoisted(() => vi.fn());
const replaceTagSuggestionsForArticleMock = vi.hoisted(() => vi.fn(async () => undefined));
const attachTagToArticleMock = vi.hoisted(() => vi.fn(async () => undefined));
const logInfoMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbAll: dbAllMock,
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  now: nowMock
}));

vi.mock('./llm', () => ({
  enhanceScore: vi.fn(),
  generateArticleTagDecisions: generateArticleTagDecisionsMock,
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
  getFeatureProviderModel: getFeatureProviderModelMock,
  getJobProcessorBatchSize: vi.fn(),
  getProviderKey: getProviderKeyMock,
  getScorePromptConfig: vi.fn(),
  getScoringMethod: getScoringMethodMock,
  getScoringAiEnhancementThreshold: vi.fn(),
  getSummaryConfig: vi.fn(),
  getTaggingMethod: getTaggingMethodMock
}));

vi.mock('./profile', () => ({
  ensurePreferenceProfile: ensurePreferenceProfileMock
}));

vi.mock('./scoring/engine', () => ({
  scoreArticleAlgorithmic: scoreArticleAlgorithmicMock
}));

vi.mock('./tagging/rules', () => ({
  generateDeterministicTagDecisions: generateDeterministicTagDecisionsMock,
  applyDeterministicTagDecisions: applyDeterministicTagDecisionsMock
}));

vi.mock('./job-queue', () => ({
  enqueueScoreJob: enqueueScoreJobMock
}));

vi.mock('./tags', () => ({
  attachTagToArticle: attachTagToArticleMock,
  listDismissedSuggestionNamesForArticle: listDismissedSuggestionNamesForArticleMock,
  listExistingTagCandidatesForArticle: listExistingTagCandidatesForArticleMock,
  normalizeTagSuggestionKey: (value: string) => value.trim().toLowerCase(),
  replaceTagSuggestionsForArticle: replaceTagSuggestionsForArticleMock
}));

vi.mock('./log', () => ({
  logInfo: logInfoMock
}));

vi.mock('./flags', () => ({
  isJobBatchV2Enabled: vi.fn(() => false)
}));

import { runAutoTagJob, runScoreJob } from './jobs';

describe('runAutoTagJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAutoTagMaxPerArticleMock.mockResolvedValue(3);
    ensurePreferenceProfileMock.mockResolvedValue({ id: 'profile-1', version: 4, profile_text: 'profile' });
    getScoringMethodMock.mockResolvedValue('algorithmic');
    getTaggingMethodMock.mockResolvedValue('algorithmic');
    getFeatureProviderModelMock.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o-mini',
      reasoningEffort: 'medium'
    });
    getProviderKeyMock.mockResolvedValue(null);
    dbGetMock.mockResolvedValue({
      title: 'AI policy shifts',
      canonical_url: 'https://example.com/ai-policy',
      content_text: null,
      source_feed_id: 'feed-1',
      source_feed_title: 'AI Policy Feed',
      source_site_url: 'https://example.com'
    });
    scoreArticleAlgorithmicMock.mockResolvedValue({
      score: 3,
      signals: [
        { signal: 'source_reputation', rawValue: 0.2, normalizedValue: 0.6, isDataBacked: true }
      ],
      weights: [],
      confidence: 0.5,
      preferenceConfidence: 0.25,
      dataBackedSignalCount: 3,
      preferenceBackedSignalCount: 1,
      weightedAverage: 0.55,
      status: 'insufficient_signal'
    });
    generateDeterministicTagDecisionsMock.mockResolvedValue([
      { tagId: 'tag-1', score: 1, confidence: 1, features: ['title_phrase'] }
    ]);
    generateArticleTagDecisionsMock.mockResolvedValue({
      matchedExistingTagIds: [],
      newSuggestions: []
    });
    listExistingTagCandidatesForArticleMock.mockResolvedValue([]);
    listDismissedSuggestionNamesForArticleMock.mockResolvedValue(new Set());
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
      sourceFeedTitle: 'AI Policy Feed',
      sourceSiteHostname: 'example.com',
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

  it('runs AI augmentation in hybrid mode when a provider key is present', async () => {
    getTaggingMethodMock.mockResolvedValueOnce('hybrid');
    getProviderKeyMock.mockResolvedValueOnce('test-key');
    dbAllMock.mockResolvedValueOnce([{ tag_id: 'tag-existing' }]);
    generateArticleTagDecisionsMock.mockResolvedValueOnce({
      matchedExistingTagIds: ['tag-existing', 'tag-2'],
      newSuggestions: [{ name: 'Policy', confidence: 0.7 }]
    });
    applyDeterministicTagDecisionsMock.mockResolvedValueOnce({
      changed: false,
      beforeState: '',
      afterState: '',
      attachedTagIds: [],
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

    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(generateArticleTagDecisionsMock).toHaveBeenCalled();
    expect(attachTagToArticleMock).toHaveBeenCalledWith(expect.anything(), {
      articleId: 'article-1',
      tagId: 'tag-2',
      source: 'ai',
      confidence: null
    });
    expect(replaceTagSuggestionsForArticleMock).toHaveBeenCalledWith(expect.anything(), {
      articleId: 'article-1',
      sourceProvider: 'openai',
      sourceModel: 'gpt-4o-mini',
      suggestions: [{ name: 'Policy', confidence: 0.7 }]
    });
    expect(enqueueScoreJobMock).toHaveBeenCalledWith(expect.anything(), 'article-1');
  });

  it('falls back cleanly to deterministic tagging in hybrid mode without a provider key', async () => {
    getTaggingMethodMock.mockResolvedValueOnce('hybrid');
    getProviderKeyMock.mockResolvedValueOnce(null);
    applyDeterministicTagDecisionsMock.mockResolvedValueOnce({
      changed: false,
      beforeState: '',
      afterState: '',
      attachedTagIds: [],
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
    expect(generateArticleTagDecisionsMock).not.toHaveBeenCalled();
    expect(replaceTagSuggestionsForArticleMock).not.toHaveBeenCalled();
  });
});

describe('runScoreJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePreferenceProfileMock.mockResolvedValue({ id: 'profile-1', version: 7, profile_text: 'profile' });
    getScoringMethodMock.mockResolvedValue('algorithmic');
    scoreArticleAlgorithmicMock.mockResolvedValue({
      score: 3,
      signals: [
        { signal: 'source_reputation', rawValue: 0.2, normalizedValue: 0.6, isDataBacked: true },
        { signal: 'content_freshness', rawValue: 4, normalizedValue: 0.95, isDataBacked: true }
      ],
      weights: [],
      confidence: 2 / 6,
      preferenceConfidence: 1 / 4,
      dataBackedSignalCount: 2,
      preferenceBackedSignalCount: 1,
      weightedAverage: 0.55,
      status: 'ready'
    });
  });

  it('persists score status and confidence metadata for algorithmic scores', async () => {
    const result = await runScoreJob(
      {} as D1Database,
      {
        DB: {} as D1Database
      } as App.Platform['env'],
      'article-1'
    );

    expect(result).toEqual({ provider: 'algorithmic', model: 'none' });
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('score_status'),
      [
        expect.any(String),
        'article-1',
        3,
        'Algorithmic (33% confidence)',
        'Weighted average: 0.550',
        JSON.stringify(['source_reputation: 0.600 (raw: 0.20)', 'content_freshness: 0.950 (raw: 4.00)']),
        1234,
        7,
        'algorithmic',
        'ready',
        2 / 6,
        1 / 4,
        0.55
      ]
    );
  });

  it('persists insufficient-signal status without dropping the completed score row', async () => {
    scoreArticleAlgorithmicMock.mockResolvedValueOnce({
      score: 3,
      signals: [],
      weights: [],
      confidence: 0,
      preferenceConfidence: 0,
      dataBackedSignalCount: 0,
      preferenceBackedSignalCount: 0,
      weightedAverage: 0.5,
      status: 'insufficient_signal'
    });

    await runScoreJob(
      {} as D1Database,
      {
        DB: {} as D1Database
      } as App.Platform['env'],
      'article-1'
    );

    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('score_status'),
      expect.arrayContaining(['insufficient_signal', 0, 0, 0.5])
    );
  });
});
