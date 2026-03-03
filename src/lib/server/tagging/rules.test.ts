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

const llmCandidate = {
  id: 'tag-llm',
  name: 'Large Language Models',
  normalizedName: 'large language models',
  slug: 'large-language-models'
};

const kubernetesCandidate = {
  id: 'tag-k8s',
  name: 'Kubernetes',
  normalizedName: 'kubernetes',
  slug: 'kubernetes'
};

const cybersecurityCandidate = {
  id: 'tag-cybersecurity',
  name: 'Cybersecurity',
  normalizedName: 'cybersecurity',
  slug: 'cybersecurity'
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

  it('matches llm keyword bags for large language models', () => {
    const decision = scoreDeterministicTagCandidate(llmCandidate, {
      title: 'New LLM benchmark lands for frontier systems',
      canonicalUrl: 'https://example.com/story',
      contentText: 'Background text'
    });

    expect(decision.features).toContain('title_phrase');
    expect(decision.score).toBeGreaterThanOrEqual(DEFAULT_DETERMINISTIC_TAG_ATTACH_THRESHOLD);
  });

  it('matches k8s keywords for kubernetes', () => {
    const decision = scoreDeterministicTagCandidate(kubernetesCandidate, {
      title: 'Why K8s cost controls are getting harder',
      canonicalUrl: 'https://example.com/story',
      contentText: 'Operators are tuning clusters again.'
    });

    expect(decision.features).toContain('title_phrase');
    expect(decision.score).toBeGreaterThanOrEqual(DEFAULT_DETERMINISTIC_TAG_ATTACH_THRESHOLD);
  });

  it('matches cybersecurity terms from content', () => {
    const decision = scoreDeterministicTagCandidate(cybersecurityCandidate, {
      title: 'Incident response update',
      canonicalUrl: 'https://example.com/story',
      contentText: 'The breach exposed a vulnerability in a widely deployed enterprise system.'
    });

    expect(decision.features).toContain('content_phrase');
    expect(decision.score).toBeGreaterThan(0.35);
  });

  it('uses feed title and site hostname as additional matching inputs', () => {
    const decision = scoreDeterministicTagCandidate(kubernetesCandidate, {
      title: 'Release notes',
      canonicalUrl: 'https://infra.example.com/story',
      contentText: 'Background text',
      feedTitle: 'Kubernetes Weekly',
      siteHostname: 'k8s.example.com'
    });

    expect(decision.features).toContain('title_phrase');
    expect(decision.features).toContain('url_phrase');
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
