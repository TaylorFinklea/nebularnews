import { describe, expect, it } from 'vitest';
import {
  normalizeReactions,
  normalizeScores,
  rankAndTruncateContextSources,
  truncateForMcp
} from './handlers';

describe('mcp handler utilities', () => {
  it('truncates content to max chars with ellipsis', () => {
    expect(truncateForMcp('abcdef', 4)).toBe('a...');
    expect(truncateForMcp('abc', 10)).toBe('abc');
    expect(truncateForMcp('', 10)).toBe('');
  });

  it('normalizes score filters with aliases', () => {
    expect(normalizeScores(['4plus'])).toEqual(['5', '4']);
    expect(normalizeScores(['3plus', 'unscored'])).toEqual(['5', '4', '3', 'unscored']);
    expect(normalizeScores(['unknown'])).toEqual(['5', '4', '3', '2', '1', 'unscored']);
  });

  it('normalizes reaction filters with defaults', () => {
    expect(normalizeReactions(['up', 'down'])).toEqual(['up', 'down']);
    expect(normalizeReactions(['none'])).toEqual(['none']);
    expect(normalizeReactions(['invalid'])).toEqual(['up', 'down', 'none']);
  });

  it('ranks and truncates context sources', () => {
    const sources = rankAndTruncateContextSources(
      [
        {
          article_id: 'a',
          title: 'Older Higher Rank',
          canonical_url: 'https://example.com/a',
          published_at: 10,
          fetched_at: 10,
          summary_text: 'A'.repeat(600),
          content_text: null,
          excerpt: null,
          score: 3,
          score_label: 'Good fit',
          source_name: 'Feed A',
          rank: 1.2
        },
        {
          article_id: 'b',
          title: 'Newer Better Rank',
          canonical_url: 'https://example.com/b',
          published_at: 20,
          fetched_at: 20,
          summary_text: 'B'.repeat(600),
          content_text: null,
          excerpt: null,
          score: 5,
          score_label: 'Strong fit',
          source_name: 'Feed B',
          rank: 0.3
        }
      ],
      120,
      1
    );

    expect(sources).toHaveLength(1);
    expect(sources[0].article_id).toBe('b');
    expect(sources[0].context_text.endsWith('...')).toBe(true);
    expect(sources[0].citation).toContain('https://example.com/b');
  });
});
