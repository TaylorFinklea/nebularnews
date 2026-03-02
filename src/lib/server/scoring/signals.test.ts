import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbAllMock = vi.hoisted(() => vi.fn());
const getFeedReputationsMock = vi.hoisted(() => vi.fn());

vi.mock('../db', () => ({
  dbAll: dbAllMock
}));

vi.mock('../sources', () => ({
  getFeedReputations: getFeedReputationsMock
}));

import { extractSignals } from './signals';

describe('extractSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses weighted source reputation summaries and marks the signal as data-backed', async () => {
    dbAllMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('FROM article_tags')) {
        return [];
      }
      if (sql.includes('FROM topic_affinities')) {
        return [];
      }
      return [];
    });
    getFeedReputationsMock.mockResolvedValue(
      new Map([
        [
          'feed-1',
          {
            feedbackCount: 2,
            weightedFeedbackCount: 2.5,
            ratingSum: 1.5,
            score: 1.5 / 7.5
          }
        ]
      ])
    );

    const signals = await extractSignals({} as D1Database, {
      id: 'article-1',
      title: 'Story',
      author: null,
      content_text: '',
      published_at: null,
      source_feed_id: 'feed-1'
    });

    const sourceSignal = signals.find((signal) => signal.signal === 'source_reputation');
    expect(getFeedReputationsMock).toHaveBeenCalledWith(expect.anything(), ['feed-1']);
    expect(sourceSignal?.rawValue).toBeCloseTo(1.5 / 7.5);
    expect(sourceSignal?.isDataBacked).toBe(true);
  });

  it('turns negatively affined tags into a negative tag-match ratio', async () => {
    dbAllMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('FROM article_tags')) {
        return [{ name_normalized: 'ai' }, { name_normalized: 'policy' }];
      }
      if (sql.includes('SELECT affinity FROM topic_affinities')) {
        return [{ affinity: -0.4 }, { affinity: 0.2 }];
      }
      if (sql.includes('SELECT tag_name_normalized, affinity')) {
        return [
          { tag_name_normalized: 'ai', affinity: -0.4 },
          { tag_name_normalized: 'policy', affinity: -0.2 }
        ];
      }
      return [];
    });
    getFeedReputationsMock.mockResolvedValue(new Map());

    const signals = await extractSignals({} as D1Database, {
      id: 'article-1',
      title: 'Story',
      author: null,
      content_text: '',
      published_at: null,
      source_feed_id: null
    });

    const tagSignal = signals.find((signal) => signal.signal === 'tag_match_ratio');
    expect(tagSignal).toMatchObject({
      rawValue: -1,
      normalizedValue: 0,
      isDataBacked: true
    });
  });

  it('marks missing tag affinity data as not data-backed', async () => {
    dbAllMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('FROM article_tags')) {
        return [{ name_normalized: 'ai' }];
      }
      if (sql.includes('FROM topic_affinities')) {
        return [];
      }
      return [];
    });
    getFeedReputationsMock.mockResolvedValue(new Map());

    const signals = await extractSignals({} as D1Database, {
      id: 'article-1',
      title: 'Story',
      author: null,
      content_text: '',
      published_at: null,
      source_feed_id: null
    });

    const topicSignal = signals.find((signal) => signal.signal === 'topic_affinity');
    const tagSignal = signals.find((signal) => signal.signal === 'tag_match_ratio');
    expect(topicSignal).toMatchObject({ normalizedValue: 0.5, isDataBacked: false });
    expect(tagSignal).toMatchObject({ normalizedValue: 0.5, isDataBacked: false });
  });
});
