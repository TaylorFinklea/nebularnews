import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbAllMock = vi.hoisted(() => vi.fn());
const dbGetMock = vi.hoisted(() => vi.fn());
const dbRunMock = vi.hoisted(() => vi.fn());
const nowMock = vi.hoisted(() => vi.fn(() => 1234));
const getScoringLearningRateMock = vi.hoisted(() => vi.fn());

vi.mock('../db', () => ({
  dbAll: dbAllMock,
  dbGet: dbGetMock,
  dbRun: dbRunMock,
  now: nowMock
}));

vi.mock('../settings', () => ({
  getScoringLearningRate: getScoringLearningRateMock
}));

import { updateTopicAffinity, updateWeightsFromReaction } from './learning';

describe('scoring learning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nowMock.mockReturnValue(1234);
    getScoringLearningRateMock.mockResolvedValue(0.25);
  });

  it('uses the configured learning rate when updating signal weights', async () => {
    dbAllMock.mockResolvedValue([{ signal_name: 'topic_affinity', normalized_value: 1 }]);
    dbGetMock.mockResolvedValue({ weight: 1, sample_count: 0 });

    await updateWeightsFromReaction({} as D1Database, 'article-1', 1);

    expect(getScoringLearningRateMock).toHaveBeenCalledWith(expect.anything());
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('UPDATE signal_weights'),
      [1.25, 1234, 'topic_affinity']
    );
  });

  it('uses the configured learning rate for a new topic affinity entry', async () => {
    dbGetMock.mockResolvedValue(null);

    await updateTopicAffinity({} as D1Database, 'ai', -1);

    expect(getScoringLearningRateMock).toHaveBeenCalledWith(expect.anything());
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO topic_affinities'),
      ['ai', -0.25, 1234]
    );
  });
});
