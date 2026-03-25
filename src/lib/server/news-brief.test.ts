import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbAllMock = vi.hoisted(() => vi.fn());
const dbGetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const preferredSourcesMock = vi.hoisted(() => vi.fn());
const getFeatureProviderModelMock = vi.hoisted(() => vi.fn());
const getNewsBriefConfigMock = vi.hoisted(() => vi.fn());
const getProviderKeyMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbAll: dbAllMock,
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  now: vi.fn(() => Date.UTC(2026, 2, 3, 12, 0, 0))
}));

vi.mock('./sources', () => ({
  getPreferredSourcesForArticles: preferredSourcesMock
}));

const getNewsBriefConfigForUserMock = vi.hoisted(() => vi.fn());

vi.mock('./settings', () => ({
  getFeatureProviderModel: getFeatureProviderModelMock,
  getNewsBriefConfig: getNewsBriefConfigMock,
  getNewsBriefConfigForUser: getNewsBriefConfigForUserMock,
  getProviderKey: getProviderKeyMock
}));

vi.mock('./llm', () => ({
  generateNewsBrief: vi.fn()
}));

vi.mock('./log', () => ({
  logInfo: vi.fn()
}));

import {
  getDashboardNewsBrief,
  getDueNewsBriefSlots,
  getNextScheduledNewsBriefAt,
  listNewsBriefCandidates
} from './news-brief';

describe('news brief scheduling and queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preferredSourcesMock.mockResolvedValue(new Map());
    const defaultConfig = {
      enabled: true,
      timezone: 'America/Chicago',
      morningTime: '08:00',
      eveningTime: '17:00',
      lookbackHours: 48,
      scoreCutoff: 3
    };
    getNewsBriefConfigMock.mockResolvedValue(defaultConfig);
    getNewsBriefConfigForUserMock.mockResolvedValue(defaultConfig);
    getFeatureProviderModelMock.mockResolvedValue({
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: 'medium'
    });
    getProviderKeyMock.mockResolvedValue('test-key');
  });

  it('computes due and upcoming slots in the configured timezone', () => {
    const referenceAt = DateTime.fromISO('2026-03-08T18:30:00', { zone: 'America/Chicago' }).toMillis();
    const config = {
      enabled: true,
      timezone: 'America/Chicago',
      morningTime: '08:00',
      eveningTime: '17:00',
      lookbackHours: 48,
      scoreCutoff: 3
    };

    const dueSlots = getDueNewsBriefSlots(config, referenceAt);
    expect(dueSlots.map((slot) => slot.editionKey)).toEqual([
      'scheduled:America/Chicago:2026-03-07:morning',
      'scheduled:America/Chicago:2026-03-07:evening',
      'scheduled:America/Chicago:2026-03-08:morning',
      'scheduled:America/Chicago:2026-03-08:evening'
    ]);

    const nextScheduledAt = getNextScheduledNewsBriefAt(config, referenceAt);
    expect(DateTime.fromMillis(nextScheduledAt, { zone: 'America/Chicago' }).toFormat('yyyy-MM-dd HH:mm')).toBe(
      '2026-03-09 08:00'
    );
  });

  it('selects candidates without read-state filtering and dedupes canonical URLs', async () => {
    dbAllMock.mockResolvedValue([
      {
        article_id: 'article-1',
        title: 'OpenAI ships a major launch',
        canonical_url: 'https://example.com/openai-launch',
        published_at: 10,
        fetched_at: 10,
        excerpt: 'Excerpt one',
        content_text: 'Content one',
        summary_text: null,
        key_points_json: '["Launch confirmed", "Developer rollout"]',
        effective_score: 5
      },
      {
        article_id: 'article-2',
        title: 'Duplicate URL version',
        canonical_url: 'https://example.com/openai-launch',
        published_at: 9,
        fetched_at: 9,
        excerpt: 'Duplicate excerpt',
        content_text: 'Duplicate content',
        summary_text: null,
        key_points_json: null,
        effective_score: 4
      },
      {
        article_id: 'article-3',
        title: 'Claude update',
        canonical_url: 'https://example.com/claude-update',
        published_at: 8,
        fetched_at: 8,
        excerpt: 'Excerpt three',
        content_text: 'Content three',
        summary_text: 'Summary three',
        key_points_json: null,
        effective_score: 4
      }
    ]);
    preferredSourcesMock.mockResolvedValue(
      new Map([
        ['article-1', { sourceName: 'Alpha Feed' }],
        ['article-3', { sourceName: 'Beta Feed' }]
      ])
    );

    const candidates = await listNewsBriefCandidates(
      {} as D1Database,
      { scoreCutoff: 3 },
      Date.UTC(2026, 2, 1),
      Date.UTC(2026, 2, 3)
    );

    const [, sql] = dbAllMock.mock.calls[0];
    expect(sql).not.toContain('article_read_state');
    expect(candidates).toEqual([
      expect.objectContaining({
        articleId: 'article-1',
        sourceName: 'Alpha Feed',
        context: 'Launch confirmed | Developer rollout'
      }),
      expect.objectContaining({
        articleId: 'article-3',
        sourceName: 'Beta Feed',
        context: 'Summary three'
      })
    ]);
  });

  it('returns unavailable when enabled but no edition exists yet', async () => {
    dbGetMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const result = await getDashboardNewsBrief(
      {} as D1Database,
      { DB: {} as D1Database } as App.Platform['env'],
      DateTime.fromISO('2026-03-03T12:00:00', { zone: 'America/Chicago' }).toMillis()
    );

    expect(result).toEqual({
      state: 'unavailable',
      title: 'News Brief',
      editionLabel: 'Awaiting first edition',
      generatedAt: null,
      windowHours: 48,
      scoreCutoff: 3,
      bullets: [],
      nextScheduledAt: DateTime.fromISO('2026-03-03T17:00:00', { zone: 'America/Chicago' }).toMillis(),
      stale: false
    });
  });

  it('returns the latest completed edition and marks it stale when a newer due slot exists', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 'edition-1',
      edition_key: 'scheduled:America/Chicago:2026-03-03:morning',
      edition_kind: 'scheduled',
      edition_slot: 'morning',
      timezone: 'America/Chicago',
      scheduled_for: DateTime.fromISO('2026-03-03T08:00:00', { zone: 'America/Chicago' }).toMillis(),
      window_start: DateTime.fromISO('2026-03-01T08:00:00', { zone: 'America/Chicago' }).toMillis(),
      window_end: DateTime.fromISO('2026-03-03T08:00:00', { zone: 'America/Chicago' }).toMillis(),
      score_cutoff: 4,
      status: 'ready',
      candidate_count: 5,
      bullets_json: JSON.stringify([
        {
          text: 'OpenAI released a new model family.',
          sources: [
            { articleId: 'article-1', title: 'OpenAI release', canonicalUrl: 'https://example.com/1' },
            { articleId: 'article-2', title: 'Second source', canonicalUrl: 'https://example.com/2' }
          ]
        }
      ]),
      source_article_ids_json: '["article-1"]',
      provider: 'openai',
      model: 'gpt-4o',
      last_error: null,
      attempts: 1,
      run_after: 0,
      generated_at: DateTime.fromISO('2026-03-03T08:02:00', { zone: 'America/Chicago' }).toMillis(),
      created_at: DateTime.fromISO('2026-03-03T08:00:00', { zone: 'America/Chicago' }).toMillis(),
      updated_at: DateTime.fromISO('2026-03-03T08:02:00', { zone: 'America/Chicago' }).toMillis()
    });

    const result = await getDashboardNewsBrief(
      {} as D1Database,
      { DB: {} as D1Database } as App.Platform['env'],
      DateTime.fromISO('2026-03-03T20:00:00', { zone: 'America/Chicago' }).toMillis()
    );

    expect(result).toEqual({
      state: 'ready',
      title: 'News Brief',
      editionLabel: 'Morning edition',
      generatedAt: DateTime.fromISO('2026-03-03T08:02:00', { zone: 'America/Chicago' }).toMillis(),
      windowHours: 48,
      scoreCutoff: 4,
      bullets: [
        {
          text: 'OpenAI released a new model family.',
          sources: [{ articleId: 'article-1', title: 'OpenAI release', canonicalUrl: 'https://example.com/1' }]
        }
      ],
      nextScheduledAt: DateTime.fromISO('2026-03-04T08:00:00', { zone: 'America/Chicago' }).toMillis(),
      stale: true
    });
  });
});
