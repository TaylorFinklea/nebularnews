import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  dbGet: dbGetMock
}));

import { getScoringObservabilitySummary } from './scoring-observability';

describe('getScoringObservabilitySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns score, confidence, tag-source, and recent-coverage summaries', async () => {
    dbGetMock.mockImplementation(async (_db, sql) => {
      if (sql.includes('low_confidence_count')) {
        return {
          ready_count: 12,
          insufficient_count: 5,
          low_confidence_count: 4,
          medium_confidence_count: 8,
          high_confidence_count: 5
        };
      }
      if (sql.includes('manual_count')) {
        return {
          manual_count: 7,
          system_count: 11,
          ai_count: 3
        };
      }
      if (sql.includes('missing_score_jobs')) {
        return {
          recent_articles: 9,
          missing_score_jobs: 2,
          missing_auto_tag_jobs: 3,
          missing_image_backfill_jobs: 1,
          recent_tagged_articles: 4
        };
      }
      return {
        recent_articles: 20,
        tagged_articles: 15,
        recent_scored_articles: 10,
        preference_backed_articles: 6
      };
    });

    const summary = await getScoringObservabilitySummary({} as any, Date.UTC(2026, 2, 2));

    expect(summary).toEqual({
      scoreStatusCounts: {
        ready: 12,
        insufficientSignal: 5
      },
      confidenceBuckets: {
        low: 4,
        medium: 8,
        high: 5
      },
      tagSourceCounts: {
        manual: 7,
        system: 11,
        ai: 3
      },
      recentCoverage: {
        windowDays: 30,
        recentArticles: 20,
        recentScoredArticles: 10,
        taggedArticlePercent: 75,
        preferenceBackedScorePercent: 60
      },
      recentJobCoverage: {
        windowHours: 24,
        recentArticles: 9,
        missingScoreJobs: 2,
        missingAutoTagJobs: 3,
        missingImageBackfillJobs: 1,
        recentTaggedArticles: 4
      }
    });
  });
});
