import { describe, expect, it } from 'vitest';
import { computeAlgorithmicScore } from './engine';

describe('computeAlgorithmicScore', () => {
  it('computes confidence from explicit data coverage', () => {
    const result = computeAlgorithmicScore(
      [
        { signal: 'topic_affinity', rawValue: 0, normalizedValue: 0.5, isDataBacked: false },
        { signal: 'source_reputation', rawValue: 0.25, normalizedValue: 0.625, isDataBacked: true },
        { signal: 'content_freshness', rawValue: 12, normalizedValue: 0.95, isDataBacked: true },
        { signal: 'content_depth', rawValue: 0, normalizedValue: 0, isDataBacked: false }
      ],
      [
        { signalName: 'topic_affinity', weight: 1, sampleCount: 0 },
        { signalName: 'source_reputation', weight: 1, sampleCount: 0 },
        { signalName: 'content_freshness', weight: 1, sampleCount: 0 },
        { signalName: 'content_depth', weight: 1, sampleCount: 0 }
      ]
    );

    expect(result.confidence).toBe(0.5);
  });
});
