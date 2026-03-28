import { dbAll, dbGet, now, type Db } from '../db';
import { getNewsBriefConfigForUser, getUserSetting, setUserSetting } from '../settings';
import { notifyUserDevices } from './apns';
import { logInfo } from '../log';
import { DateTime } from 'luxon';

const DIGEST_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const DIGEST_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours between digests
const DIGEST_SLOT_TOLERANCE_MS = 10 * 60 * 1000; // 10 minute window around scheduled time

async function runNotificationDigestForUser(db: Db, env: App.Platform['env'], userId: string) {
  const config = await getNewsBriefConfigForUser(db, userId);
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
  const lastSentRaw = await getUserSetting(db, userId, 'last_notification_digest_at');
  const lastSentAt = lastSentRaw ? Number(lastSentRaw) : 0;
  if (referenceAt - lastSentAt < DIGEST_COOLDOWN_MS) return;

  // Query unread high-fit articles from last 12 hours for this user's subscribed feeds
  const cutoff = referenceAt - DIGEST_WINDOW_MS;
  const stats = await dbGet<{ count: number; top_title: string | null }>(
    db,
    `SELECT
       COUNT(*) as count,
       (SELECT a2.title FROM articles a2
        INNER JOIN article_scores s2 ON s2.article_id = a2.id
        WHERE COALESCE(a2.published_at, a2.fetched_at) >= ?
          AND s2.score >= 4
          AND COALESCE((SELECT is_read FROM article_read_state WHERE article_id = a2.id AND user_id = ? LIMIT 1), 0) = 0
          AND EXISTS (
            SELECT 1 FROM article_sources src
            JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
            WHERE src.article_id = a2.id AND ufs.user_id = ?
          )
        ORDER BY s2.score DESC, a2.published_at DESC
        LIMIT 1) as top_title
     FROM articles a
     INNER JOIN article_scores s ON s.article_id = a.id
     WHERE COALESCE(a.published_at, a.fetched_at) >= ?
       AND s.score >= 4
       AND COALESCE((SELECT is_read FROM article_read_state WHERE article_id = a.id AND user_id = ? LIMIT 1), 0) = 0
       AND EXISTS (
         SELECT 1 FROM article_sources src
         JOIN user_feed_subscriptions ufs ON ufs.feed_id = src.feed_id
         WHERE src.article_id = a.id AND ufs.user_id = ?
       )`,
    [cutoff, userId, userId, cutoff, userId, userId]
  );

  const count = stats?.count ?? 0;
  if (count === 0) return;

  const slotName = morningDiff <= DIGEST_SLOT_TOLERANCE_MS ? 'morning' : 'evening';
  const topTitle = stats?.top_title ?? 'New articles waiting for you';

  const result = await notifyUserDevices(db, env, userId, {
    alert: {
      title: `${count} high-fit article${count === 1 ? '' : 's'}`,
      body: count === 1 ? topTitle : `Including: ${topTitle}`
    },
    sound: 'default'
  });

  await setUserSetting(db, userId, 'last_notification_digest_at', String(referenceAt));
  logInfo('push.digest.sent', { userId, slot: slotName, count, sent: result.sent, failed: result.failed });
}

export async function runNotificationDigest(db: Db, env: App.Platform['env']) {
  // Find all users who have device tokens registered
  const userRows = await dbAll<{ user_id: string }>(
    db,
    'SELECT DISTINCT user_id FROM device_tokens WHERE platform = ?',
    ['ios']
  );

  // Fall back to admin if no device tokens exist yet (backward compat)
  const userIds = userRows.length > 0 ? userRows.map((r) => r.user_id) : ['admin'];

  for (const userId of userIds) {
    await runNotificationDigestForUser(db, env, userId);
  }
}
