import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbGet, dbRun } from '../db/helpers';
import { parseEmail } from '../lib/email-parser';

const EMAIL_DOMAIN = 'read.nebularnews.com';

/**
 * Handle an incoming email via Cloudflare Email Workers.
 *
 * Flow:
 * 1. Extract token from the `to` address
 * 2. Look up user by token
 * 3. Parse MIME email
 * 4. Find or create newsletter feed for the sender
 * 5. Create article from email content
 * 6. Link article to feed
 */
export async function handleEmail(
  message: { from: string; to: string; raw: ReadableStream<Uint8Array>; headers: Headers },
  env: Env,
): Promise<void> {
  const db = env.DB;

  // 1. Extract token from `to` address.
  const toAddress = message.to.toLowerCase();
  const atIndex = toAddress.indexOf('@');
  if (atIndex === -1) {
    console.error('[email] Invalid to address:', toAddress);
    return;
  }
  const token = toAddress.slice(0, atIndex);
  const domain = toAddress.slice(atIndex + 1);

  if (domain !== EMAIL_DOMAIN) {
    console.error('[email] Unknown domain:', domain);
    return;
  }

  // 2. Look up user.
  const tokenRow = await dbGet<{ user_id: string }>(
    db,
    `SELECT user_id FROM email_ingest_tokens WHERE token = ?`,
    [token],
  );

  if (!tokenRow) {
    console.error('[email] Unknown token:', token);
    return;
  }

  const userId = tokenRow.user_id;

  // 3. Parse the email.
  const parsed = await parseEmail(message.raw);
  const senderEmail = parsed.from.address.toLowerCase();
  const senderName = parsed.from.name ?? senderEmail.split('@')[0];

  // 4. Find or create newsletter feed for this sender.
  const feedUrl = `mailto:${senderEmail}`;
  let feed = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM feeds WHERE url = ? AND feed_type = 'email_newsletter'`,
    [feedUrl],
  );

  const now = Date.now();

  if (!feed) {
    const feedId = nanoid();
    await dbRun(
      db,
      `INSERT INTO feeds (id, url, title, feed_type, scrape_mode, disabled, created_at)
       VALUES (?, ?, ?, 'email_newsletter', 'rss_only', 0, ?)`,
      [feedId, feedUrl, senderName, now],
    );
    feed = { id: feedId };
  }

  // Ensure user is subscribed to this feed.
  await dbRun(
    db,
    `INSERT OR IGNORE INTO user_feed_subscriptions (id, user_id, feed_id, paused, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [nanoid(), userId, feed.id, now, now],
  );

  // 5. Create article.
  const canonicalUrl = `email://${parsed.messageId}`;

  // Check for duplicate.
  const existing = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM articles WHERE canonical_url = ?`,
    [canonicalUrl],
  );

  if (existing) {
    // Already processed — just ensure the source link exists.
    await dbRun(
      db,
      `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), existing.id, feed.id, parsed.messageId, parsed.date?.getTime() ?? now, now],
    );
    return;
  }

  // Strip HTML to get plain text if we have HTML but no text.
  const contentHtml = parsed.html;
  const contentText = parsed.text ?? (parsed.html ? stripHtml(parsed.html) : '');
  const excerpt = contentText.slice(0, 300);
  const wordCount = contentText.split(/\s+/).filter(Boolean).length;

  const articleId = nanoid();
  await dbRun(
    db,
    `INSERT INTO articles (id, canonical_url, guid, title, author, content_html, content_text, excerpt, word_count, published_at, fetched_at, extraction_method, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email', ?)`,
    [
      articleId, canonicalUrl, parsed.messageId,
      parsed.subject, senderName,
      contentHtml, contentText, excerpt, wordCount,
      parsed.date?.getTime() ?? now, now, now,
    ],
  );

  // 6. Link article to feed.
  await dbRun(
    db,
    `INSERT INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nanoid(), articleId, feed.id, parsed.messageId, parsed.date?.getTime() ?? now, now],
  );

  console.log(`[email] Ingested newsletter from ${senderEmail}: "${parsed.subject}" for user ${userId}`);
}

/** Simple HTML tag stripper for fallback text extraction. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
