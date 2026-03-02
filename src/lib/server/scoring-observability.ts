import { dbGet, type Db } from './db';

const RECENT_WINDOW_DAYS = 30;
const DAY_MS = 1000 * 60 * 60 * 24;

const percentage = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

export type ScoringObservabilitySummary = {
  scoreStatusCounts: {
    ready: number;
    insufficientSignal: number;
  };
  confidenceBuckets: {
    low: number;
    medium: number;
    high: number;
  };
  tagSourceCounts: {
    manual: number;
    system: number;
    ai: number;
  };
  recentCoverage: {
    windowDays: number;
    recentArticles: number;
    recentScoredArticles: number;
    taggedArticlePercent: number;
    preferenceBackedScorePercent: number;
  };
};

export async function getScoringObservabilitySummary(
  db: Db,
  referenceAt = Date.now()
): Promise<ScoringObservabilitySummary> {
  const latestScoreStats = await dbGet<{
    ready_count: number | null;
    insufficient_count: number | null;
    low_confidence_count: number | null;
    medium_confidence_count: number | null;
    high_confidence_count: number | null;
  }>(
    db,
    `WITH latest_scores AS (
       SELECT sc.article_id, sc.score_status, sc.confidence
       FROM article_scores sc
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_scores
         GROUP BY article_id
       ) latest
         ON latest.article_id = sc.article_id
        AND latest.created_at = sc.created_at
     )
     SELECT
       COALESCE(SUM(CASE WHEN score_status = 'ready' THEN 1 ELSE 0 END), 0) as ready_count,
       COALESCE(SUM(CASE WHEN score_status = 'insufficient_signal' THEN 1 ELSE 0 END), 0) as insufficient_count,
       COALESCE(SUM(CASE WHEN confidence < 0.34 THEN 1 ELSE 0 END), 0) as low_confidence_count,
       COALESCE(SUM(CASE WHEN confidence >= 0.34 AND confidence < 0.67 THEN 1 ELSE 0 END), 0) as medium_confidence_count,
       COALESCE(SUM(CASE WHEN confidence >= 0.67 THEN 1 ELSE 0 END), 0) as high_confidence_count
     FROM latest_scores`
  );

  const tagSourceStats = await dbGet<{
    manual_count: number | null;
    system_count: number | null;
    ai_count: number | null;
  }>(
    db,
    `SELECT
      COALESCE(SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END), 0) as manual_count,
      COALESCE(SUM(CASE WHEN source = 'system' THEN 1 ELSE 0 END), 0) as system_count,
      COALESCE(SUM(CASE WHEN source = 'ai' THEN 1 ELSE 0 END), 0) as ai_count
     FROM article_tags`
  );

  const recentCutoff = referenceAt - RECENT_WINDOW_DAYS * DAY_MS;
  const recentCoverage = await dbGet<{
    recent_articles: number | null;
    tagged_articles: number | null;
    recent_scored_articles: number | null;
    preference_backed_articles: number | null;
  }>(
    db,
    `WITH latest_scores AS (
       SELECT sc.article_id, sc.preference_confidence
       FROM article_scores sc
       JOIN (
         SELECT article_id, MAX(created_at) as created_at
         FROM article_scores
         GROUP BY article_id
       ) latest
         ON latest.article_id = sc.article_id
        AND latest.created_at = sc.created_at
     ),
     recent_articles AS (
       SELECT id
       FROM articles
       WHERE COALESCE(published_at, fetched_at, 0) >= ?
     )
     SELECT
       COUNT(*) as recent_articles,
       COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM article_tags t WHERE t.article_id = ra.id) THEN 1 ELSE 0 END), 0) as tagged_articles,
       COALESCE(SUM(CASE WHEN ls.article_id IS NOT NULL THEN 1 ELSE 0 END), 0) as recent_scored_articles,
       COALESCE(SUM(CASE WHEN ls.article_id IS NOT NULL AND COALESCE(ls.preference_confidence, 0) > 0 THEN 1 ELSE 0 END), 0) as preference_backed_articles
     FROM recent_articles ra
     LEFT JOIN latest_scores ls ON ls.article_id = ra.id`,
    [recentCutoff]
  );

  const recentArticles = Number(recentCoverage?.recent_articles ?? 0);
  const recentScoredArticles = Number(recentCoverage?.recent_scored_articles ?? 0);
  const taggedArticles = Number(recentCoverage?.tagged_articles ?? 0);
  const preferenceBackedArticles = Number(recentCoverage?.preference_backed_articles ?? 0);

  return {
    scoreStatusCounts: {
      ready: Number(latestScoreStats?.ready_count ?? 0),
      insufficientSignal: Number(latestScoreStats?.insufficient_count ?? 0)
    },
    confidenceBuckets: {
      low: Number(latestScoreStats?.low_confidence_count ?? 0),
      medium: Number(latestScoreStats?.medium_confidence_count ?? 0),
      high: Number(latestScoreStats?.high_confidence_count ?? 0)
    },
    tagSourceCounts: {
      manual: Number(tagSourceStats?.manual_count ?? 0),
      system: Number(tagSourceStats?.system_count ?? 0),
      ai: Number(tagSourceStats?.ai_count ?? 0)
    },
    recentCoverage: {
      windowDays: RECENT_WINDOW_DAYS,
      recentArticles,
      recentScoredArticles,
      taggedArticlePercent: percentage(taggedArticles, recentArticles),
      preferenceBackedScorePercent: percentage(preferenceBackedArticles, recentScoredArticles)
    }
  };
}
