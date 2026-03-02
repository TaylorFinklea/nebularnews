import { describe, expect, it } from 'vitest';
import { computeAlgorithmicScore } from './engine';
import type { SignalResult, SignalWeight } from './types';

const weights: SignalWeight[] = [
  { signalName: 'topic_affinity', weight: 1.0, sampleCount: 0 },
  { signalName: 'source_reputation', weight: 0.8, sampleCount: 0 },
  { signalName: 'content_freshness', weight: 0.6, sampleCount: 0 },
  { signalName: 'content_depth', weight: 0.5, sampleCount: 0 },
  { signalName: 'author_affinity', weight: 0.7, sampleCount: 0 },
  { signalName: 'tag_match_ratio', weight: 0.9, sampleCount: 0 }
];

const compute = (signals: SignalResult[]) => computeAlgorithmicScore(signals, weights);

describe('computeAlgorithmicScore', () => {
  it('computes confidence from explicit data coverage', () => {
    const result = compute(
      [
        { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
        { signal: 'source_reputation', rawValue: 0.25, normalizedValue: 0.625, isDataBacked: true },
        { signal: 'content_freshness', rawValue: 12, normalizedValue: 0.95, isDataBacked: true },
        { signal: 'content_depth', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
        { signal: 'author_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
        { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0.5, isDataBacked: false }
      ]
    );

    expect(result.confidence).toBeCloseTo(2 / 6);
    expect(result.preferenceConfidence).toBeCloseTo(1 / 4);
    expect(result.dataBackedSignalCount).toBe(2);
    expect(result.preferenceBackedSignalCount).toBe(1);
    expect(result.status).toBe('ready');
  });

  it('keeps missing tags and content neutral instead of depressing the score', () => {
    const result = compute([
      { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'source_reputation', rawValue: 1, normalizedValue: 1, isDataBacked: true },
      { signal: 'content_freshness', rawValue: 2, normalizedValue: 0.99, isDataBacked: true },
      { signal: 'content_depth', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'author_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0.5, isDataBacked: false }
    ]);

    expect(result.weightedAverage).toBeCloseTo(0.6542222222, 6);
    expect(result.score).toBe(4);
    expect(result.status).toBe('ready');
  });

  it('scores a no-content, no-tag article as neutral instead of low by default', () => {
    const result = compute([
      { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'source_reputation', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'content_freshness', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'content_depth', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'author_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0.5, isDataBacked: false }
    ]);

    expect(result.weightedAverage).toBeCloseTo(0.5, 6);
    expect(result.score).toBe(3);
    expect(result.confidence).toBe(0);
    expect(result.preferenceConfidence).toBe(0);
    expect(result.status).toBe('insufficient_signal');
  });

  it('rewards positively tagged articles with strong source and freshness signals', () => {
    const result = compute([
      { signal: 'topic_affinity', rawValue: 0.7, normalizedValue: 0.8, isDataBacked: true },
      { signal: 'source_reputation', rawValue: 0.5, normalizedValue: 0.75, isDataBacked: true },
      { signal: 'content_freshness', rawValue: 4, normalizedValue: 0.98, isDataBacked: true },
      { signal: 'content_depth', rawValue: 1200, normalizedValue: 0.7, isDataBacked: true },
      { signal: 'author_affinity', rawValue: 0.4, normalizedValue: 0.69, isDataBacked: true },
      { signal: 'tag_match_ratio', rawValue: 1, normalizedValue: 1, isDataBacked: true }
    ]);

    expect(result.weightedAverage).toBeCloseTo(0.8268888889, 6);
    expect(result.score).toBe(4);
    expect(result.confidence).toBe(1);
    expect(result.preferenceConfidence).toBe(1);
    expect(result.status).toBe('ready');
  });

  it('penalizes negatively affined tagged articles', () => {
    const result = compute([
      { signal: 'topic_affinity', rawValue: -0.5, normalizedValue: 0.27, isDataBacked: true },
      { signal: 'source_reputation', rawValue: -0.3, normalizedValue: 0.35, isDataBacked: true },
      { signal: 'content_freshness', rawValue: 36, normalizedValue: 0.86, isDataBacked: true },
      { signal: 'content_depth', rawValue: 600, normalizedValue: 0.22, isDataBacked: true },
      { signal: 'author_affinity', rawValue: -0.4, normalizedValue: 0.31, isDataBacked: true },
      { signal: 'tag_match_ratio', rawValue: -1, normalizedValue: 0, isDataBacked: true }
    ]);

    expect(result.weightedAverage).toBeCloseTo(0.3095555556, 6);
    expect(result.score).toBe(2);
    expect(result.status).toBe('ready');
  });

  it('supports source-driven scoring even without topic or author data', () => {
    const result = compute([
      { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'source_reputation', rawValue: 0.8, normalizedValue: 0.9, isDataBacked: true },
      { signal: 'content_freshness', rawValue: 8, normalizedValue: 0.97, isDataBacked: true },
      { signal: 'content_depth', rawValue: 980, normalizedValue: 0.44, isDataBacked: true },
      { signal: 'author_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
      { signal: 'tag_match_ratio', rawValue: 0, normalizedValue: 0.5, isDataBacked: false }
    ]);

    expect(result.weightedAverage).toBeCloseTo(0.6271111111, 6);
    expect(result.score).toBe(4);
    expect(result.confidence).toBeCloseTo(0.5);
    expect(result.preferenceConfidence).toBeCloseTo(0.25);
    expect(result.status).toBe('ready');
  });
});
