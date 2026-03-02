import { dbAll, dbGet, dbRun, now, type Db } from '../db';
import { DAMPING_FACTOR, LEARNING_RATE, type SignalName } from './types';

// ─── EMA weight update ──────────────────────────────────────────────

/**
 * Computes effective learning rate with damping.
 * As sample_count grows, the effective alpha shrinks — early interactions
 * have more influence than later ones, achieving stability.
 */
function effectiveAlpha(sampleCount: number): number {
  return LEARNING_RATE / (1 + sampleCount / DAMPING_FACTOR);
}

// ─── Signal weight updates ──────────────────────────────────────────

/**
 * Update signal weights based on user feedback on an article.
 *
 * For a positive reaction (direction = +1):
 *   Signals with high normalizedValue are rewarded (their weights increase).
 *   Signals with low normalizedValue receive small updates.
 *
 * For a negative reaction (direction = -1):
 *   Signals with high normalizedValue are penalized (their weights decrease).
 *   Signals with low normalizedValue receive small updates.
 */
export async function updateWeightsFromReaction(
  db: Db,
  articleId: string,
  direction: 1 | -1
): Promise<void> {
  // Load the article's signal scores
  const signals = await dbAll<{ signal_name: string; normalized_value: number }>(
    db,
    'SELECT signal_name, normalized_value FROM article_signal_scores WHERE article_id = ?',
    [articleId]
  );

  if (signals.length === 0) return;

  const ts = now();

  for (const signal of signals) {
    const row = await dbGet<{ weight: number; sample_count: number }>(
      db,
      'SELECT weight, sample_count FROM signal_weights WHERE signal_name = ?',
      [signal.signal_name]
    );

    if (!row) continue;

    const alpha = effectiveAlpha(row.sample_count);

    // Error signal: how much did this signal contribute to the prediction?
    // For positive feedback: reward signals proportional to their contribution
    // For negative feedback: penalize signals proportional to their contribution
    let error: number;
    if (direction === 1) {
      // Positive: signal should have high value → reward weight
      error = signal.normalized_value;
    } else {
      // Negative: signal led to bad prediction → penalize weight
      error = -signal.normalized_value;
    }

    const newWeight = Math.max(0.01, row.weight + alpha * error);

    await dbRun(
      db,
      'UPDATE signal_weights SET weight = ?, sample_count = sample_count + 1, updated_at = ? WHERE signal_name = ?',
      [newWeight, ts, signal.signal_name]
    );
  }
}

// ─── Topic affinity updates ─────────────────────────────────────────

/**
 * Update topic affinity for a specific tag.
 * direction: +1 for positive signal (reaction up, tag accept)
 *           -1 for negative signal (reaction down, tag dismiss)
 */
export async function updateTopicAffinity(
  db: Db,
  tagNameNormalized: string,
  direction: 1 | -1
): Promise<void> {
  const ts = now();
  const existing = await dbGet<{ affinity: number; interaction_count: number }>(
    db,
    'SELECT affinity, interaction_count FROM topic_affinities WHERE tag_name_normalized = ?',
    [tagNameNormalized]
  );

  if (existing) {
    const alpha = effectiveAlpha(existing.interaction_count);
    const newAffinity = existing.affinity + alpha * direction;

    await dbRun(
      db,
      'UPDATE topic_affinities SET affinity = ?, interaction_count = interaction_count + 1, updated_at = ? WHERE tag_name_normalized = ?',
      [newAffinity, ts, tagNameNormalized]
    );
  } else {
    // First interaction creates the entry
    const initialAffinity = LEARNING_RATE * direction;
    await dbRun(
      db,
      'INSERT INTO topic_affinities (tag_name_normalized, affinity, interaction_count, updated_at) VALUES (?, ?, 1, ?)',
      [tagNameNormalized, initialAffinity, ts]
    );
  }
}

/**
 * Update topic affinities for all tags on an article based on a reaction.
 */
export async function updateTopicAffinitiesForArticle(
  db: Db,
  articleId: string,
  direction: 1 | -1
): Promise<void> {
  const tags = await dbAll<{ name_normalized: string }>(
    db,
    `SELECT t.name_normalized
     FROM article_tags at
     JOIN tags t ON at.tag_id = t.id
     WHERE at.article_id = ?`,
    [articleId]
  );

  for (const tag of tags) {
    await updateTopicAffinity(db, tag.name_normalized, direction);
  }
}

// ─── Author affinity updates ────────────────────────────────────────

/**
 * Update author affinity.
 * direction: +1 for positive signal, -1 for negative signal
 */
export async function updateAuthorAffinity(
  db: Db,
  authorNormalized: string,
  direction: 1 | -1
): Promise<void> {
  const ts = now();
  const existing = await dbGet<{ affinity: number; interaction_count: number }>(
    db,
    'SELECT affinity, interaction_count FROM author_affinities WHERE author_normalized = ?',
    [authorNormalized]
  );

  if (existing) {
    const alpha = effectiveAlpha(existing.interaction_count);
    const newAffinity = existing.affinity + alpha * direction;

    await dbRun(
      db,
      'UPDATE author_affinities SET affinity = ?, interaction_count = interaction_count + 1, updated_at = ? WHERE author_normalized = ?',
      [newAffinity, ts, authorNormalized]
    );
  } else {
    const initialAffinity = LEARNING_RATE * direction;
    await dbRun(
      db,
      'INSERT INTO author_affinities (author_normalized, affinity, interaction_count, updated_at) VALUES (?, ?, 1, ?)',
      [authorNormalized, initialAffinity, ts]
    );
  }
}

/**
 * Update author affinity for an article's author based on a reaction.
 */
export async function updateAuthorAffinityForArticle(
  db: Db,
  articleId: string,
  direction: 1 | -1
): Promise<void> {
  const row = await dbGet<{ author: string | null }>(
    db,
    'SELECT author FROM articles WHERE id = ?',
    [articleId]
  );

  if (row?.author?.trim()) {
    await updateAuthorAffinity(db, row.author.trim().toLowerCase(), direction);
  }
}

// ─── Combined feedback handler ──────────────────────────────────────

/**
 * Process all learning updates when a user reacts to an article.
 * Call this after persisting the reaction.
 */
export async function processReactionLearning(
  db: Db,
  articleId: string,
  reactionValue: 1 | -1
): Promise<void> {
  await Promise.all([
    updateWeightsFromReaction(db, articleId, reactionValue),
    updateTopicAffinitiesForArticle(db, articleId, reactionValue),
    updateAuthorAffinityForArticle(db, articleId, reactionValue)
  ]);
}

/**
 * Process learning updates from manual feedback (1-5 rating).
 * Maps rating to direction: >= 4 → +1, <= 2 → -1, 3 → no update.
 */
export async function processFeedbackLearning(
  db: Db,
  articleId: string,
  rating: number
): Promise<void> {
  let direction: 1 | -1 | null = null;
  if (rating >= 4) direction = 1;
  else if (rating <= 2) direction = -1;

  if (direction === null) return; // neutral rating, no learning

  await processReactionLearning(db, articleId, direction);
}

// ─── Reset helpers ──────────────────────────────────────────────────

/**
 * Reset all learned weights to defaults.
 */
export async function resetSignalWeights(db: Db): Promise<void> {
  const { DEFAULT_SIGNAL_WEIGHTS } = await import('./types');
  const ts = now();
  for (const [name, weight] of Object.entries(DEFAULT_SIGNAL_WEIGHTS)) {
    await dbRun(
      db,
      `INSERT INTO signal_weights (signal_name, weight, sample_count, updated_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(signal_name) DO UPDATE SET weight = ?, sample_count = 0, updated_at = ?`,
      [name, weight, ts, weight, ts]
    );
  }
}

/**
 * Reset all topic and author affinities.
 */
export async function resetAffinities(db: Db): Promise<void> {
  await dbRun(db, 'DELETE FROM topic_affinities');
  await dbRun(db, 'DELETE FROM author_affinities');
}
