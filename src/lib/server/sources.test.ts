import { describe, expect, it } from 'vitest';
import { computeFeedReputation, pickPreferredSource } from './sources';

describe('computeFeedReputation', () => {
  it('returns neutral score without feedback', () => {
    expect(computeFeedReputation(0, 0)).toBe(0);
  });

  it('raises score above zero when ratings trend positive', () => {
    expect(computeFeedReputation(5, 5)).toBeGreaterThan(0);
  });

  it('drops score below zero when ratings trend negative', () => {
    expect(computeFeedReputation(-5, 5)).toBeLessThan(0);
  });
});

describe('pickPreferredSource', () => {
  it('picks source with better reputation', () => {
    const preferred = pickPreferredSource(
      [
        {
          article_id: 'article-1',
          feed_id: 'feed-a',
          published_at: 100,
          feed_title: 'Feed A',
          site_url: 'https://a.example.com',
          feed_url: 'https://a.example.com/rss'
        },
        {
          article_id: 'article-1',
          feed_id: 'feed-b',
          published_at: 200,
          feed_title: 'Feed B',
          site_url: 'https://b.example.com',
          feed_url: 'https://b.example.com/rss'
        }
      ],
      new Map([
        ['feed-a', { feedbackCount: 8, ratingSum: 8, score: 0.6 }],
        ['feed-b', { feedbackCount: 8, ratingSum: -4, score: -0.3 }]
      ])
    );

    expect(preferred?.feedId).toBe('feed-a');
  });
});
