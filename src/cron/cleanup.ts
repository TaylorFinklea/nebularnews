import type { Env } from '../env';
import type { D1Database } from '@cloudflare/workers-types';
import { dbRun, dbAll } from '../db/helpers';

// ---------------------------------------------------------------------------
// R2 preview sweep
//
// Lists all objects under previews/* and deletes any whose R2 `uploaded`
// timestamp is older than 24 hours. These are generate-without-commit
// leftovers. The listing cursor loop handles buckets with more than 1000
// preview objects (unlikely but safe).
// ---------------------------------------------------------------------------

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function sweepR2Previews(env: Env, now: number): Promise<void> {
  if (!env.R2_FALLBACK) return; // binding absent in dev without local R2

  let cursor: string | undefined;
  let deleted = 0;

  do {
    const listed = await env.R2_FALLBACK.list({
      prefix: 'previews/',
      cursor,
    });
    cursor = listed.truncated ? listed.cursor : undefined;

    const stale = listed.objects.filter(
      (obj) => now - obj.uploaded.getTime() > PREVIEW_TTL_MS,
    );

    if (stale.length > 0) {
      await Promise.all(stale.map((obj) => env.R2_FALLBACK.delete(obj.key)));
      deleted += stale.length;
    }
  } while (cursor);

  if (deleted > 0) {
    console.log(`[cleanup] swept ${deleted} stale R2 preview objects`);
  }
}

export async function cleanup(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Provider usage rollup runs first so the prune below can safely drop
  // raw rows that have already been summarized.
  await rollupProviderUsage(db, now);

  // 1. Delete orphan articles older than 90 days (no subscribed feeds)
  await dbRun(db,
    `DELETE FROM articles
     WHERE created_at < ?
       AND id NOT IN (
         SELECT DISTINCT asrc.article_id
         FROM article_sources asrc
         JOIN user_feed_subscriptions ufs ON ufs.feed_id = asrc.feed_id
       )`,
    [ninetyDaysAgo],
  );

  // 2. Delete expired sessions (better-auth session table)
  await dbRun(db,
    `DELETE FROM session WHERE expiresAt < ?`,
    [now],
  );

  // 3. Delete completed jobs older than 7 days
  await dbRun(db,
    `DELETE FROM jobs WHERE status = 'completed' AND completed_at < ?`,
    [sevenDaysAgo],
  );

  // 4. Delete old pull_runs older than 30 days
  await dbRun(db,
    `DELETE FROM pull_runs WHERE created_at < ?`,
    [thirtyDaysAgo],
  );

  // 5. Prune provider_calls older than 30 days. Daily rollups in
  //    provider_usage_daily preserve the long-term shape; raw rows are only
  //    needed for "today / this week" inspection.
  await dbRun(db,
    `DELETE FROM provider_calls WHERE started_at < ?`,
    [thirtyDaysAgo],
  );

  // 6. Expire stale unresolved tool_call_proposals older than 10 minutes.
  //    Doesn't rollback anything (nothing was applied) — just reclaims state
  //    so the table doesn't grow unbounded.
  const tenMinutesAgo = now - 10 * 60 * 1000;
  await dbRun(db,
    `UPDATE tool_call_proposals SET resolved_at = ?, resolution = 'expired'
     WHERE resolved_at IS NULL AND created_at < ?`,
    [now, tenMinutesAgo],
  );

  // 7. Sweep stale R2 preview objects (generate-without-commit leftovers).
  await sweepR2Previews(env, now);
}

// ---------------------------------------------------------------------------
// Provider usage rollup
//
// Computes per-provider, per-day call/success/error counts and p50/p95
// latency from provider_calls and writes (or upserts) into
// provider_usage_daily. We re-roll up the trailing N days each run rather
// than just yesterday so that backfilled rows or late-arriving calls don't
// get silently lost. The per-row work is tiny — each row in provider_calls
// is a single ~80-byte INSERT, and at current scrape rates we see ~1000
// rows/day, so a 7-day window stays well under D1 limits.
// ---------------------------------------------------------------------------

const ROLLUP_WINDOW_DAYS = 7;

async function rollupProviderUsage(db: D1Database, now: number): Promise<void> {
  const startWindow = utcMidnight(now - ROLLUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Pull every call in the window. Modest result size (~7k rows worst case
  // at 10x current rate) — we compute percentiles in JS rather than relying
  // on D1's limited window functions.
  const rows = await dbAll<{
    provider: string;
    started_at: number;
    duration_ms: number;
    success: number;
  }>(db,
    `SELECT provider, started_at, duration_ms, success
       FROM provider_calls
      WHERE started_at >= ?
      ORDER BY provider ASC, started_at ASC`,
    [startWindow],
  );

  if (rows.length === 0) return;

  // Group by (provider, day_unix). Day bucket = UTC midnight of started_at.
  const buckets = new Map<string, { provider: string; day: number; durations: number[]; success: number; error: number }>();
  for (const r of rows) {
    const day = utcMidnight(r.started_at);
    const key = `${r.provider}:${day}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { provider: r.provider, day, durations: [], success: 0, error: 0 };
      buckets.set(key, bucket);
    }
    bucket.durations.push(r.duration_ms);
    if (r.success === 1) bucket.success++;
    else bucket.error++;
  }

  // Upsert each bucket. ON CONFLICT(provider, day_unix) keeps the row
  // current; a re-run with new data overwrites the rollup.
  for (const b of buckets.values()) {
    const sorted = b.durations.slice().sort((a, z) => a - z);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const total = sorted.reduce((a, z) => a + z, 0);
    const callCount = sorted.length;

    await dbRun(db,
      `INSERT INTO provider_usage_daily (provider, day_unix, call_count, success_count, error_count, total_duration_ms, p50_duration_ms, p95_duration_ms, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, day_unix) DO UPDATE SET
         call_count = excluded.call_count,
         success_count = excluded.success_count,
         error_count = excluded.error_count,
         total_duration_ms = excluded.total_duration_ms,
         p50_duration_ms = excluded.p50_duration_ms,
         p95_duration_ms = excluded.p95_duration_ms,
         computed_at = excluded.computed_at`,
      [b.provider, b.day, callCount, b.success, b.error, total, p50, p95, now],
    );
  }

  console.log(`[cleanup] rolled up ${buckets.size} provider-day buckets from ${rows.length} calls`);
}

function utcMidnight(unixMs: number): number {
  return Math.floor(unixMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[idx];
}
