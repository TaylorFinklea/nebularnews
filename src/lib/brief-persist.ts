/**
 * Shared persistence helper for news brief editions.
 *
 * Both the on-demand `/brief/generate` endpoint and the scheduled cron write
 * through this to keep the `news_brief_editions` row shape consistent with
 * what `/today` reads back. The table has many NOT NULL columns; missing one
 * causes a silent per-user failure (swallowed by the cron's try/catch), which
 * is how the auto-fire cron and manual generate were both effectively
 * no-ops for persistence.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { dbRun } from '../db/helpers';

export interface PersistBriefInput {
  userId: string;
  editionKind: 'morning' | 'evening' | 'ondemand';
  editionSlot: string; // e.g. 'morning-2026-04-21' or 'ondemand-<nanoid>'
  timezone: string;
  windowStart: number;
  windowEnd: number;
  scoreCutoff: number;
  bullets: unknown[];
  sourceArticleIds: string[];
  provider: string;
  model: string;
  candidateCount: number;
  now: number;
}

/**
 * Insert a completed brief. `edition_key` is UNIQUE; duplicate attempts on
 * the same (user, kind, slot) return false without throwing so callers can
 * treat a re-fire as idempotent.
 */
export async function persistBrief(db: D1Database, input: PersistBriefInput): Promise<boolean> {
  const editionKey = `${input.userId}:${input.editionKind}:${input.editionSlot}`;
  try {
    await dbRun(
      db,
      `INSERT INTO news_brief_editions (
         id, user_id, edition_key, edition_kind, edition_slot, timezone,
         scheduled_for, window_start, window_end, score_cutoff,
         status, candidate_count, bullets_json, source_article_ids_json,
         provider, model, attempts, run_after, generated_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        nanoid(),
        input.userId,
        editionKey,
        input.editionKind,
        input.editionSlot,
        input.timezone,
        input.now,
        input.windowStart,
        input.windowEnd,
        input.scoreCutoff,
        input.candidateCount,
        JSON.stringify(input.bullets),
        JSON.stringify(input.sourceArticleIds),
        input.provider,
        input.model,
        input.now,
        input.now,
        input.now,
        input.now,
      ],
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // UNIQUE(edition_key) collisions are expected on re-fire; swallow.
    if (msg.includes('UNIQUE')) return false;
    throw err;
  }
}
