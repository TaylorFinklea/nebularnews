import { describe, expect, it } from 'vitest';
import {
  scoreDeterministicTagCandidate,
  DEFAULT_DETERMINISTIC_TAG_ATTACH_THRESHOLD
} from './rules';

const candidate = {
  id: 'tag-ai-policy',
  name: 'AI Policy',
  normalizedName: 'ai policy',
  slug: 'ai-policy'
};

describe('deterministic tagging rules', () => {
  it('scores an exact title phrase above the attach threshold', () => {
    const decision = scoreDeterministicTagCandidate(candidate, {
      title: 'Why AI Policy Is Changing Fast',
      canonicalUrl: 'https://example.com/story',
      contentText: 'Background text'
    });

    expect(decision.features).toContain('title_phrase');
    expect(decision.score).toBeGreaterThanOrEqual(DEFAULT_DETERMINISTIC_TAG_ATTACH_THRESHOLD);
  });

  it('scores an exact URL phrase match', () => {
    const decision = scoreDeterministicTagCandidate(candidate, {
      title: 'Story',
      canonicalUrl: 'https://policy.example.com/topics/ai-policy-explained',
      contentText: 'Background text'
    });

    expect(decision.features).toContain('url_phrase');
    expect(decision.score).toBeCloseTo(0.4, 4);
  });

  it('scores token overlap from title and content', () => {
    const decision = scoreDeterministicTagCandidate(candidate, {
      title: 'New policy regulation story',
      canonicalUrl: 'https://example.com/story',
      contentText: 'This analysis covers policy debates around frontier systems.'
    });

    expect(decision.features).toContain('title_overlap:1');
    expect(decision.features).toContain('content_overlap:1');
    expect(decision.score).toBeCloseTo(0.38, 4);
  });

  it('applies the feed prior bonus only when counts and ratio are high enough', () => {
    const decision = scoreDeterministicTagCandidate(
      candidate,
      {
        title: 'Story',
        canonicalUrl: 'https://example.com/story',
        contentText: 'Background text'
      },
      {
        taggedArticleCount: 3,
        ratio: 0.3
      }
    );

    expect(decision.features).toContain('feed_prior');
    expect(decision.score).toBeCloseTo(0.25, 4);
  });

  it('does not apply the feed prior bonus when the sample is too small', () => {
    const decision = scoreDeterministicTagCandidate(
      candidate,
      {
        title: 'Story',
        canonicalUrl: 'https://example.com/story',
        contentText: 'Background text'
      },
      {
        taggedArticleCount: 2,
        ratio: 0.5
      }
    );

    expect(decision.features).not.toContain('feed_prior');
    expect(decision.score).toBe(0);
  });
});
