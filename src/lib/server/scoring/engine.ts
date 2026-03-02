import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from '../db';
import { extractSignals, type ArticleForScoring } from './signals';
import {
  DEFAULT_SIGNAL_WEIGHTS,
  MIN_DATA_BACKED_SIGNALS_TO_PUBLISH,
  MIN_PREFERENCE_BACKED_SIGNALS_TO_PUBLISH,
  PREFERENCE_BACKED_SIGNAL_NAMES,
  SIGNAL_NAMES,
  type AlgorithmicScore,
  type SignalName,
  type SignalResult,
  type SignalWeight
} from './types';

// ─── Weight loading ──────────────────────────────────────────────────

export async function loadSignalWeights(db: Db): Promise<SignalWeight[]> {
  const rows = await dbAll<{ signal_name: string; weight: number; sample_count: number }>(
    db,
    'SELECT signal_name, weight, sample_count FROM signal_weights'
  );

  const weightMap = new Map(rows.map((r) => [r.signal_name, r]));

  return SIGNAL_NAMES.map((name) => {
    const row = weightMap.get(name);
    return {
      signalName: name,
      weight: row?.weight ?? DEFAULT_SIGNAL_WEIGHTS[name],
      sampleCount: row?.sample_count ?? 0
    };
  });
}

// ─── Core scoring computation ────────────────────────────────────────

export function computeAlgorithmicScore(
  signals: SignalResult[],
  weights: SignalWeight[]
): AlgorithmicScore {
  const weightMap = new Map(weights.map((w) => [w.signalName, w]));
  const preferenceSignalNames = new Set(PREFERENCE_BACKED_SIGNAL_NAMES);

  let weightedSum = 0;
  let totalWeight = 0;
  let dataSignalCount = 0;
  let preferenceSignalCount = 0;
  let preferenceBackedSignalCount = 0;

  for (const signal of signals) {
    const w = weightMap.get(signal.signal);
    const weight = w?.weight ?? DEFAULT_SIGNAL_WEIGHTS[signal.signal] ?? 1.0;
    weightedSum += weight * signal.normalizedValue;
    totalWeight += weight;
    if (signal.isDataBacked) {
      dataSignalCount++;
      if (preferenceSignalNames.has(signal.signal)) {
        preferenceBackedSignalCount++;
      }
    }
    if (preferenceSignalNames.has(signal.signal)) {
      preferenceSignalCount++;
    }
  }

  const weightedAverage = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

  // Map 0-1 range to 1-5 score
  const rawScore = 1 + 4 * weightedAverage;
  const score = Math.max(1, Math.min(5, Math.round(rawScore)));

  // Confidence: proportion of signals with actual data (not defaults)
  const confidence = signals.length > 0 ? dataSignalCount / signals.length : 0;
  const preferenceConfidence = preferenceSignalCount > 0 ? preferenceBackedSignalCount / preferenceSignalCount : 0;
  const status =
    dataSignalCount >= MIN_DATA_BACKED_SIGNALS_TO_PUBLISH &&
    preferenceBackedSignalCount >= MIN_PREFERENCE_BACKED_SIGNALS_TO_PUBLISH
      ? 'ready'
      : 'insufficient_signal';

  return {
    score,
    signals,
    weights,
    confidence,
    preferenceConfidence,
    dataBackedSignalCount: dataSignalCount,
    preferenceBackedSignalCount,
    weightedAverage,
    status
  };
}

// ─── Persist signal scores ───────────────────────────────────────────

async function persistSignalScores(db: Db, articleId: string, signals: SignalResult[]) {
  const ts = now();
  for (const signal of signals) {
    await dbRun(
      db,
      `INSERT INTO article_signal_scores (id, article_id, signal_name, raw_value, normalized_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(article_id, signal_name) DO UPDATE SET
         raw_value = excluded.raw_value,
         normalized_value = excluded.normalized_value,
         created_at = excluded.created_at`,
      [nanoid(), articleId, signal.signal, signal.rawValue, signal.normalizedValue, ts]
    );
  }
}

// ─── Full orchestrator ───────────────────────────────────────────────

export async function scoreArticleAlgorithmic(
  db: Db,
  articleId: string
): Promise<AlgorithmicScore> {
  // Load article data needed for signal extraction
  const article = await dbGet<ArticleForScoring>(
    db,
    `SELECT a.id, a.title, a.author, a.content_text, a.published_at,
            (SELECT src.feed_id FROM article_sources src WHERE src.article_id = a.id
             ORDER BY src.published_at DESC NULLS LAST LIMIT 1) as source_feed_id
     FROM articles a
     WHERE a.id = ?`,
    [articleId]
  );

  if (!article) {
    throw new Error(`Article not found: ${articleId}`);
  }

  // Extract signals
  const signals = await extractSignals(db, article);

  // Load weights
  const weights = await loadSignalWeights(db);

  // Compute score
  const result = computeAlgorithmicScore(signals, weights);

  // Persist signal breakdown
  await persistSignalScores(db, articleId, signals);

  return result;
}

// ─── Load existing signal scores for an article ──────────────────────

export async function getArticleSignalScores(
  db: Db,
  articleId: string
): Promise<SignalResult[]> {
  const rows = await dbAll<{ signal_name: string; raw_value: number; normalized_value: number }>(
    db,
    'SELECT signal_name, raw_value, normalized_value FROM article_signal_scores WHERE article_id = ?',
    [articleId]
  );

  return rows.map((r) => ({
    signal: r.signal_name as SignalName,
    rawValue: r.raw_value,
    normalizedValue: r.normalized_value,
    isDataBacked: r.normalized_value !== 0.5 || r.raw_value !== 0
  }));
}
