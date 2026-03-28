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

import { processReactionLearning, updateTopicAffinity, updateWeightsFromReaction } from './learning';

describe('scoring learning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nowMock.mockReturnValue(1234);
    getScoringLearningRateMock.mockResolvedValue(0.25);
  });

  it('uses the configured learning rate when updating signal weights without reasons', async () => {
    dbAllMock.mockResolvedValue([{ signal_name: 'topic_affinity', normalized_value: 1 }]);
    dbGetMock.mockResolvedValue({ weight: 1, sample_count: 0 });

    await updateWeightsFromReaction({} as any, 'article-1', 1);

    expect(getScoringLearningRateMock).toHaveBeenCalledWith(expect.anything());
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('UPDATE signal_weights'),
      [1.25, 1234, 'topic_affinity']
    );
  });

  it('boosts targeted signals more strongly than untargeted ones when reasons are present', async () => {
    dbAllMock.mockResolvedValue([
      { signal_name: 'topic_affinity', normalized_value: 1 },
      { signal_name: 'source_reputation', normalized_value: 1 }
    ]);
    dbGetMock.mockResolvedValue({ weight: 1, sample_count: 0 });

    await updateWeightsFromReaction({} as any, 'article-1', 1, 0.2, ['up_interest_match']);

    expect(dbRunMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.stringContaining('UPDATE signal_weights'),
      [1.3, 1234, 'topic_affinity']
    );
    expect(dbRunMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.stringContaining('UPDATE signal_weights'),
      [1.05, 1234, 'source_reputation']
    );
  });

  it('uses the configured learning rate for a new topic affinity entry', async () => {
    dbGetMock.mockResolvedValue(null);

    await updateTopicAffinity({} as any, 'ai', -1);

    expect(getScoringLearningRateMock).toHaveBeenCalledWith(expect.anything());
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO topic_affinities'),
      ['ai', -0.25, 1234]
    );
  });

  it('preserves broad topic and author learning when no reasons are supplied', async () => {
    dbAllMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('SELECT signal_name, normalized_value FROM article_signal_scores')) {
        return [];
      }
      if (sql.includes('FROM article_tags')) {
        return [{ name_normalized: 'ai' }];
      }
      return [];
    });
    dbGetMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('SELECT author FROM articles')) {
        return { author: 'Ada Lovelace' };
      }
      if (sql.includes('FROM topic_affinities')) {
        return null;
      }
      if (sql.includes('FROM author_affinities')) {
        return null;
      }
      return null;
    });

    await processReactionLearning({} as any, 'article-1', 1, []);

    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO topic_affinities'),
      ['ai', 0.25, 1234]
    );
    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO author_affinities'),
      ['ada lovelace', 0.25, 1234]
    );
  });

  it('skips topic and author affinity updates for source-only reasons', async () => {
    dbAllMock.mockResolvedValue([]);

    await processReactionLearning({} as any, 'article-1', 1, ['up_source_trust']);

    expect(dbRunMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('topic_affinities'),
      expect.anything()
    );
    expect(dbRunMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('author_affinities'),
      expect.anything()
    );
  });

  it('updates author affinity without touching topic affinity for author reasons', async () => {
    dbAllMock.mockResolvedValue([]);
    dbGetMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('SELECT author FROM articles')) {
        return { author: 'Ada Lovelace' };
      }
      if (sql.includes('FROM author_affinities')) {
        return null;
      }
      return null;
    });

    await processReactionLearning({} as any, 'article-1', 1, ['up_author_like']);

    expect(dbRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('INSERT INTO author_affinities'),
      ['ada lovelace', 0.25, 1234]
    );
    expect(dbRunMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('topic_affinities'),
      expect.anything()
    );
  });
});
