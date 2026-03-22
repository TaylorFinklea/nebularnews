import { dbGet, now } from '../db';
import { getNewsBriefConfig } from '../settings';
import { getSetting, setSetting } from '../settings';
import { notifyAllDevices } from './apns';
import { logInfo } from '../log';
import { DateTime } from 'luxon';

const DIGEST_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const DIGEST_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours between digests
const DIGEST_SLOT_TOLERANCE_MS = 10 * 60 * 1000; // 10 minute window around scheduled time

export async function runNotificationDigest(db: D1Database, env: App.Platform['env']) {
  const config = await getNewsBriefConfig(db);
  if (!config.enabled) return;

  const referenceAt = now();
  const localNow = DateTime.fromMillis(referenceAt, { zone: config.timezone });

  // Check if we're within 10 minutes of morning or evening time
  const [morningH, morningM] = config.morningTime.split(':').map(Number);
  const [eveningH, eveningM] = config.eveningTime.split(':').map(Number);

  const morningSlot = localNow.set({ hour: morningH, minute: morningM, second: 0, millisecond: 0 });
  const eveningSlot = localNow.set({ hour: eveningH, minute: eveningM, second: 0, millisecond: 0 });

  const morningDiff = Math.abs(localNow.toMillis() - morningSlot.toMillis());
  const eveningDiff = Math.abs(localNow.toMillis() - eveningSlot.toMillis());

  const isDigestTime = morningDiff <= DIGEST_SLOT_TOLERANCE_MS || eveningDiff <= DIGEST_SLOT_TOLERANCE_MS;
  if (!isDigestTime) return;

  // Check cooldown — don't send if we already sent recently
  const lastSentRaw = await getSetting(db, 'last_notification_digest_at');
  const lastSentAt = lastSentRaw ? Number(lastSentRaw) : 0;
  if (referenceAt - lastSentAt < DIGEST_COOLDOWN_MS) return;

  // Query unread high-fit articles from last 12 hours
  const cutoff = referenceAt - DIGEST_WINDOW_MS;
  const stats = await dbGet<{ count: number; top_title: string | null }>(
    db,
    `SELECT
       COUNT(*) as count,
       (SELECT a2.title FROM articles a2
        INNER JOIN article_scores s2 ON s2.article_id = a2.id
        WHERE COALESCE(a2.published_at, a2.fetched_at) >= ?
          AND s2.score >= 4
          AND COALESCE((SELECT is_read FROM article_read_state WHERE article_id = a2.id LIMIT 1), 0) = 0
        ORDER BY s2.score DESC, a2.published_at DESC
        LIMIT 1) as top_title
     FROM articles a
     INNER JOIN article_scores s ON s.article_id = a.id
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND s.score >= 4
       AND COALESCE((SELECT is_read FROM article_read_state WHERE article_id = a.id LIMIT 1), 0) = 0`,
    [cutoff, cutoff]
  );

  const count = stats?.count ?? 0;
  if (count === 0) return;

  const slotName = morningDiff <= DIGEST_SLOT_TOLERANCE_MS ? 'morning' : 'evening';
  const topTitle = stats?.top_title ?? 'New articles waiting for you';

  const result = await notifyAllDevices(db, env, {
    alert: {
      title: `${count} high-fit article${count === 1 ? '' : 's'}`,
      body: count === 1 ? topTitle : `Including: ${topTitle}`
    },
    sound: 'default'
  });

  await setSetting(db, 'last_notification_digest_at', String(referenceAt));
  logInfo('push.digest.sent', { slot: slotName, count, sent: result.sent, failed: result.failed });
}
