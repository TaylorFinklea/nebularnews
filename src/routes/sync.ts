import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbRun } from '../db/helpers';

export const syncRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// POST /sync/enrichment — store on-device AI results in D1
//
// Called by the iOS app after on-device FoundationModels inference.
// The server stores results in the same tables as server-generated enrichment
// so all tiers have consistent data.
// ---------------------------------------------------------------------------

type SyncBody = {
  article_id: string;
  type: 'summary' | 'key_points' | 'score' | 'chat_message' | 'brief';
  result: Record<string, unknown>;
  provider: string;
  model: string;
};

syncRoutes.post('/sync/enrichment', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const body = await c.req.json<SyncBody>();
  if (!body.article_id || !body.type || !body.result) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'Missing required fields' } }, 400);
  }

  const now = Date.now();
  const provider = body.provider ?? 'foundation_models';
  const model = body.model ?? 'system';

  switch (body.type) {
    case 'summary': {
      await dbRun(
        db,
        `INSERT INTO article_summaries (id, article_id, summary_text, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          nanoid(), body.article_id,
          body.result.summary_text ?? '', provider, model, now,
        ],
      );
      break;
    }

    case 'key_points': {
      const keyPointsJson = JSON.stringify(body.result.key_points ?? []);
      await dbRun(
        db,
        `INSERT INTO article_key_points (id, article_id, key_points_json, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [nanoid(), body.article_id, keyPointsJson, provider, model, now],
      );
      break;
    }

    case 'score': {
      await dbRun(
        db,
        `INSERT INTO article_scores (id, article_id, user_id, score, label, reason_text, score_status, scoring_method, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ready', 'ai', ?, ?, ?)`,
        [
          nanoid(), body.article_id, userId,
          body.result.score ?? 3, body.result.label ?? '',
          body.result.reason ?? '', provider, model, now,
        ],
      );
      break;
    }

    case 'chat_message': {
      // Store an on-device chat response.
      if (body.result.thread_id && body.result.content) {
        await dbRun(
          db,
          `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
          [nanoid(), body.result.thread_id, body.result.content, provider, model, now],
        );
      }
      break;
    }

    case 'brief': {
      const bulletsJson = JSON.stringify(body.result.bullets ?? []);
      const articleIds = JSON.stringify(body.result.article_ids ?? []);
      await dbRun(
        db,
        `INSERT INTO news_brief_editions (id, user_id, edition_type, brief_text, article_ids_json, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), userId, body.result.edition_type ?? 'on_device', bulletsJson, articleIds, provider, model, now],
      );
      break;
    }
  }

  return c.json({ ok: true, data: { synced: true } });
});
