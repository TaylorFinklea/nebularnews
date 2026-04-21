import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, parseJsonResponse } from '../lib/ai';
import { buildNewsBriefPrompt } from '../lib/prompts';
import { sendPushToUser } from '../lib/apns';

// ---------------------------------------------------------------------------
// Scheduled briefs cron — runs hourly, generates and pushes briefs
// for users whose configured morning/evening time has arrived.
// ---------------------------------------------------------------------------

/**
 * Return hour, minute, seconds, and the start-of-day epoch millis for a given
 * moment expressed in the supplied IANA timezone. Falls back to UTC if the
 * timezone string is empty or unrecognized. dayStartMs is computed as
 * `now - (local hours + minutes + seconds since midnight)` which is stable
 * across DST transitions for the purpose of same-day dedup.
 */
function momentInZone(now: Date, timezone: string): { hour: number; minute: number; dayStartMs: number } {
  const tz = timezone || 'UTC';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);
  } catch {
    return {
      hour: now.getUTCHours(),
      minute: now.getUTCMinutes(),
      dayStartMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    };
  }
  const pick = (type: string, fallback = '0') =>
    parseInt(parts.find((p) => p.type === type)?.value ?? fallback, 10);

  // Intl sometimes reports "24" for midnight — normalize to 0.
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  const minute = pick('minute');
  const second = pick('second');
  const msIntoLocalDay = hour * 3_600_000 + minute * 60_000 + second * 1_000;
  const dayStartMs = now.getTime() - msIntoLocalDay;
  return { hour, minute, dayStartMs };
}

export async function generateScheduledBriefs(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const nowDate = new Date(now);

  // Find users with brief enabled and whose morning or evening time matches current hour.
  // settings stores 'newsBriefEnabled', 'newsBriefMorningTime' (HH:mm), 'newsBriefEveningTime' (HH:mm),
  // and 'newsBriefTimezone' (IANA identifier; defaults to UTC).
  const enabledUsers = await dbAll<{ user_id: string }>(
    db,
    `SELECT DISTINCT user_id FROM settings WHERE key = 'newsBriefEnabled' AND value = 'true'`,
  );

  for (const { user_id } of enabledUsers) {
    try {
      const morningRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefMorningTime'`, [user_id]);
      const eveningRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefEveningTime'`, [user_id]);
      const tzRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefTimezone'`, [user_id]);

      const morningTime = morningRow?.value ?? '08:00';
      const eveningTime = eveningRow?.value ?? '17:00';
      const timezone = tzRow?.value ?? 'UTC';

      const { hour: localHour, minute: localMinute, dayStartMs } = momentInZone(nowDate, timezone);

      const morningHour = parseInt(morningTime.split(':')[0]) || 8;
      const eveningHour = parseInt(eveningTime.split(':')[0]) || 17;

      let editionType: 'morning' | 'evening' | null = null;
      if (localHour === morningHour && localMinute < 30) editionType = 'morning';
      else if (localHour === eveningHour && localMinute < 30) editionType = 'evening';

      if (!editionType) continue;

      // Check if a brief was already generated for this edition today
      // (using the user's local day so a 23:00 brief doesn't re-fire across
      // UTC-day rollover).
      const existing = await dbGet<{ id: string }>(
        db,
        `SELECT id FROM news_brief_editions WHERE user_id = ? AND edition_type = ? AND created_at >= ?`,
        [user_id, editionType, dayStartMs],
      );
      if (existing) continue;

      // Resolve AI key.
      const dummyReq = new Request('https://api.nebularnews.com', { headers: new Headers() });
      const ai = await resolveAIKey(db, user_id, dummyReq, env);
      if (!ai) continue;

      // Load user settings.
      const lookbackRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefLookbackHours'`, [user_id]);
      const cutoffRow = await dbGet<{ value: string }>(db, `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefScoreCutoff'`, [user_id]);
      const lookbackHours = parseInt(lookbackRow?.value ?? '') || 12;
      const scoreCutoff = parseInt(cutoffRow?.value ?? '') || 3;

      // Get subscribed feed IDs.
      const subFeeds = await dbAll<{ feed_id: string }>(db, `SELECT feed_id FROM user_feed_subscriptions WHERE user_id = ? AND paused = 0`, [user_id]);
      if (subFeeds.length === 0) continue;

      const feedIds = subFeeds.map(s => s.feed_id);
      const feedPlaceholders = feedIds.map(() => '?').join(',');
      const cutoffMs = now - lookbackHours * 3_600_000;

      // Get scored articles.
      const articles = await dbAll<{ id: string; title: string; published_at: number | null; feed_id: string }>(
        db,
        `SELECT a.id, a.title, a.published_at, asrc.feed_id
         FROM articles a
         JOIN article_sources asrc ON asrc.article_id = a.id
         JOIN article_scores sc ON sc.article_id = a.id AND sc.user_id = ?
         WHERE asrc.feed_id IN (${feedPlaceholders}) AND asrc.created_at >= ? AND sc.score >= ?
         GROUP BY a.id
         ORDER BY sc.score DESC, a.published_at DESC
         LIMIT 20`,
        [user_id, ...feedIds, cutoffMs, scoreCutoff],
      );

      if (articles.length === 0) continue;

      // Build candidates with summaries.
      const candidates = [];
      for (const a of articles) {
        const summary = await dbGet<{ summary_text: string }>(db, `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`, [a.id]);
        const score = await dbGet<{ score: number }>(db, `SELECT score FROM article_scores WHERE article_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`, [a.id, user_id]);
        const feed = await dbGet<{ title: string }>(db, `SELECT title FROM feeds WHERE id = ?`, [a.feed_id]);
        candidates.push({
          id: a.id,
          title: a.title ?? 'Untitled',
          sourceName: feed?.title ?? null,
          publishedAt: a.published_at,
          effectiveScore: score?.score ?? 3,
          context: summary?.summary_text ?? '',
        });
      }

      const windowLabel = editionType === 'morning' ? 'Morning Brief' : 'Evening Brief';
      const messages = buildNewsBriefPrompt(candidates, windowLabel, 5);
      const { content } = await runChat(ai.provider, ai.apiKey, ai.model, messages);
      const parsed = parseJsonResponse(content) as Record<string, unknown> | null;
      const bullets = Array.isArray(parsed?.bullets) ? parsed!.bullets : [];

      // Save brief.
      const briefText = JSON.stringify(bullets);
      const articleIdsJson = JSON.stringify(candidates.map(c => c.id));
      await dbRun(db,
        `INSERT INTO news_brief_editions (id, user_id, edition_type, brief_text, article_ids_json, provider, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), user_id, editionType, briefText, articleIdsJson, ai.provider, ai.model, now],
      );

      // Send push notification.
      const bulletSummary = bullets.slice(0, 3).map((b: { text?: string }) => b.text ?? '').join(' • ');
      await sendPushToUser(db, env, user_id, {
        title: editionType === 'morning' ? 'Morning Brief' : 'Evening Brief',
        body: bulletSummary || 'Your news brief is ready.',
        data: { type: 'brief', edition: editionType },
      });

    } catch (err) {
      console.error(`[scheduled-briefs] Error for user ${user_id}:`, err);
    }
  }
}
