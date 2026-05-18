import { nanoid } from 'nanoid';
import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import type { Env } from './env';
import { dbGet, dbRun } from './db/helpers';
import { parseEmail } from './lib/email-parser';
import { extractEmailBody } from './lib/email-extract';

// Cloudflare Email Routing dispatches received messages to this handler.
// We look up the feed by To: address, parse the MIME, run TOFU sender
// filtering, extract the body via Readability, and INSERT an article.
// Unknown recipient → reject (Cloudflare bounces). Parse failure → log
// and bail (Cloudflare won't bounce; the email is silently dropped — the
// alternative is bouncing every malformed MIME which is worse UX).

interface FeedRow {
  id: string;
  expected_sender: string | null;
}

/**
 * TOFU sender check. Returns true if the article should be quarantined
 * (sender doesn't match the expected one). Returns false when:
 *   - expected is null (no TOFU lock yet — first email through)
 *   - expected matches actual (case-insensitive)
 */
export function shouldQuarantine(expected: string | null, actual: string): boolean {
  if (expected === null) return false;
  return expected.toLowerCase() !== actual.toLowerCase();
}

/**
 * Build a canonical URL for an email article. Prefers Message-Id (always
 * unique, present on virtually every modern email); falls back to a hash
 * of the body when Message-Id is missing.
 */
export async function emailCanonicalUrl(messageId: string | null, body: string): Promise<string> {
  if (messageId) return `mid:${messageId}`;
  const bytes = new TextEncoder().encode(body);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // 16 hex chars (64 bits) is plenty for dedup at personal scale.
  return `mid:hash-${hashHex.slice(0, 16)}`;
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();

  // 1. Look up feed by recipient address.
  const recipient = message.to.toLowerCase();
  const feed = await dbGet<FeedRow>(
    db,
    `SELECT id, expected_sender FROM feeds
       WHERE inbound_address = ? AND disabled = 0`,
    [recipient],
  );
  if (!feed) {
    message.setReject('unknown-recipient');
    return;
  }

  // 2. Parse MIME.
  let parsed;
  try {
    parsed = await parseEmail(message.raw);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[email] parse failed for feed ${feed.id}:`, errMsg);
    return;
  }

  // 3. TOFU sender check.
  const quarantined = shouldQuarantine(feed.expected_sender, parsed.fromAddress);
  if (!feed.expected_sender && parsed.fromAddress) {
    await dbRun(
      db,
      `UPDATE feeds SET expected_sender = ? WHERE id = ?`,
      [parsed.fromAddress, feed.id],
    );
  }

  // 4. Extract body.
  const body = extractEmailBody(parsed.htmlBody, parsed.textBody);

  // 5. Build canonical URL (Message-Id preferred, hash fallback).
  // Fallback hash input: when there's no body (rare — Readability failed on
  // HTML with no text part), salt with sender + subject + timestamp so each
  // such email gets a unique canonical_url rather than all colliding on the
  // SHA-256 of empty string.
  const hashInput = body.contentText.length > 0
    ? body.contentText
    : `${parsed.fromAddress}:${parsed.subject}:${now}`;
  const canonicalUrl = await emailCanonicalUrl(parsed.messageId, hashInput);

  // 6. Dedup.
  const existing = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM articles WHERE source_type = 'email_newsletter' AND canonical_url = ?`,
    [canonicalUrl],
  );
  if (existing) return;

  // 7. INSERT article + article_sources.
  const articleId = nanoid();
  try {
    await dbRun(
      db,
      `INSERT INTO articles
         (id, title, canonical_url, guid, author,
          content_html, content_text, excerpt, word_count, image_url,
          published_at, fetched_at, source_type, source_data_json,
          quarantined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email_newsletter', ?, ?)`,
      [
        articleId,
        parsed.subject || '(no subject)',
        canonicalUrl,
        parsed.messageId ?? canonicalUrl,
        parsed.from || parsed.fromAddress || '(unknown sender)',
        body.contentHtml,
        body.contentText,
        body.excerpt,
        body.wordCount,
        body.imageUrl,
        now,                                              // published_at: when we received it
        now,
        JSON.stringify({
          from_address: parsed.fromAddress,
          list_id: parsed.listId,
          archive_url: parsed.archiveUrl,
          quarantined_reason: quarantined ? 'sender_mismatch' : null,
        }),
        quarantined ? now : null,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed') && msg.includes('canonical_url')) {
      // Dedup race: another concurrent invocation INSERTed first. Treat as success.
      console.warn(`[email] dedup race on ${canonicalUrl}, skipping`);
      return;
    }
    throw err;
  }

  await dbRun(
    db,
    `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nanoid(), articleId, feed.id, parsed.messageId ?? canonicalUrl, now, now],
  );

  // Update feed metadata: title from first email's List-Id or From: display.
  await dbRun(
    db,
    `UPDATE feeds SET last_polled_at = ?,
                      title = COALESCE(title, ?)
       WHERE id = ?`,
    [now, parsed.listId ?? parsed.from, feed.id],
  );
}
