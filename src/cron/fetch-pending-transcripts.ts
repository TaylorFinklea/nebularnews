import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbRun } from '../db/helpers';
import { fetchTranscript } from '../lib/transcript';

// Cron sibling to retry-empty-articles. Runs on the hourly slot and picks
// up to 25 youtube articles that still don't have a transcript attached,
// running each through fetchTranscript and updating the DB. A 3-strike cap
// prevents permanently-uncaptioned videos (live streams, shorts without
// auto-captions, region-locked, etc.) from being retried forever.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 25;
const MAX_ATTEMPTS = 3;

interface PendingRow {
  id: string;
  source_data_json: string | null;
}

/**
 * Extract the YouTube video id from an article's source_data_json.
 * Returns null for any malformed input.
 */
export function videoIdFromSourceData(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { video_id?: unknown };
    return typeof parsed.video_id === 'string' ? parsed.video_id : null;
  } catch {
    return null;
  }
}

export async function fetchPendingTranscripts(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const since = now - THIRTY_DAYS_MS;

  const rows = await dbAll<PendingRow>(
    db,
    `SELECT id, source_data_json
       FROM articles
      WHERE source_type = 'youtube'
        AND transcript_fetched_at IS NULL
        AND transcript_attempt_count < ?
        AND COALESCE(published_at, fetched_at) > ?
      ORDER BY published_at DESC
      LIMIT ?`,
    [MAX_ATTEMPTS, since, BATCH_LIMIT],
  );

  if (rows.length === 0) return;

  let fetched = 0;
  let failed = 0;

  for (const row of rows) {
    const videoId = videoIdFromSourceData(row.source_data_json);
    if (!videoId) {
      await dbRun(
        db,
        `UPDATE articles
            SET transcript_attempt_count = transcript_attempt_count + 1,
                transcript_last_error = ?
          WHERE id = ?`,
        ['missing video_id in source_data_json', row.id],
      );
      failed++;
      continue;
    }

    try {
      const result = await fetchTranscript(videoId);
      if (!result) {
        await dbRun(
          db,
          `UPDATE articles
              SET transcript_attempt_count = transcript_attempt_count + 1,
                  transcript_last_error = ?
            WHERE id = ?`,
          ['no transcript available', row.id],
        );
        failed++;
        continue;
      }

      const excerpt = result.text.slice(0, 300);
      const wordCount = result.text.split(/\s+/).filter(Boolean).length;

      // Merge has_transcript=true into source_data_json. Read existing JSON,
      // set the flag, write back. Null/malformed → start from {}.
      let merged: Record<string, unknown> = {};
      if (row.source_data_json) {
        try { merged = JSON.parse(row.source_data_json) as Record<string, unknown>; }
        catch { merged = {}; }
      }
      merged.has_transcript = true;
      merged.transcript_segment_count = result.segmentCount;

      await dbRun(
        db,
        `UPDATE articles
            SET content_text = ?,
                word_count = ?,
                excerpt = ?,
                transcript_fetched_at = ?,
                transcript_lang = ?,
                transcript_last_error = NULL,
                source_data_json = ?
          WHERE id = ?`,
        [result.text, wordCount, excerpt, now, result.language, JSON.stringify(merged), row.id],
      );
      fetched++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[fetch-pending-transcripts] Error for ${row.id}:`, errMsg);
      await dbRun(
        db,
        `UPDATE articles
            SET transcript_attempt_count = transcript_attempt_count + 1,
                transcript_last_error = ?
          WHERE id = ?`,
        [errMsg.slice(0, 500), row.id],
      );
      failed++;
    }
  }

  await dbRun(
    db,
    `INSERT INTO pull_runs (id, status, trigger, started_at, completed_at, stats_json, created_at, updated_at)
     VALUES (?, 'done', 'cron', ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      now,
      Date.now(),
      JSON.stringify({ source: 'youtube-transcripts', candidates: rows.length, fetched, failed }),
      now,
      now,
    ],
  );
}
