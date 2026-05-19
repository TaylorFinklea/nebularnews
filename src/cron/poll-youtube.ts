import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { parseFeed } from '../lib/feed-parser';
import { canonicalizeUrl } from '../lib/canonical-url';

// Cron sibling to pollFeeds. Polls YouTube channel uploads via the public
// Atom feed at /feeds/videos.xml?channel_id=UC… — no API key required.
// Transcripts are NOT fetched in this version; the article body just has
// the channel-supplied description. A follow-up phase will add transcript
// pulls once we settle on a Workers-friendly transcript library.

const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface YoutubeFeed {
  id: string;
  url: string;             // canonical UCxxxx channel id
  error_count: number;
  scrape_mode: string;
  feed_type: string | null;
}

export async function pollYoutube(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const maxFeeds = parseInt(env.MAX_FEEDS_PER_POLL) || 8;

  const feeds = await dbAll<YoutubeFeed>(
    db,
    `SELECT id, url, error_count, scrape_mode, feed_type
       FROM feeds
      WHERE disabled = 0
        AND source_type = 'youtube'
        AND (next_poll_at IS NULL OR next_poll_at <= ?)
      ORDER BY next_poll_at ASC
      LIMIT ?`,
    [now, maxFeeds],
  );

  if (feeds.length === 0) return;

  let totalNew = 0;
  let totalErrors = 0;

  for (const feed of feeds) {
    try {
      const channelId = feed.url;
      const fetchUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

      const res = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'NebularNews/1.0 (MCP server; +https://nebularnews.com)',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const parsed = parseFeed(xml);

      for (const item of parsed.items.slice(0, 25)) {
        const canonicalUrl = item.url;
        if (!canonicalUrl) continue;

        const existing = await dbGet<{ id: string }>(
          db,
          `SELECT id FROM articles WHERE source_type = 'youtube' AND canonical_url = ?`,
          [canonicalUrl],
        );
        if (existing) continue;

        // Pull video id from canonical URL for the source_data payload.
        const videoIdMatch = canonicalUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        const articleId = nanoid();
        const contentText = item.contentText ?? '';
        const wordCount = contentText.split(/\s+/).filter(Boolean).length;
        const excerpt = contentText ? contentText.slice(0, 300) : null;

        await dbRun(
          db,
          `INSERT INTO articles
             (id, title, canonical_url, guid, author,
              content_html, content_text, excerpt, word_count, image_url,
              published_at, fetched_at, source_type, source_data_json,
              canonical_url_normalized)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'youtube', ?, ?)`,
          [
            articleId,
            item.title,
            canonicalUrl,
            item.guid ?? `yt:${videoId ?? canonicalUrl}`,
            item.author,
            item.contentHtml,
            contentText,
            excerpt,
            wordCount,
            item.imageUrl,
            item.publishedAt,
            now,
            JSON.stringify({
              channel_id: channelId,
              video_id: videoId,
              has_transcript: false,        // populated later
            }),
            canonicalizeUrl(canonicalUrl),
          ],
        );

        await dbRun(
          db,
          `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [nanoid(), articleId, feed.id, item.guid ?? canonicalUrl, item.publishedAt, now],
        );

        totalNew++;
      }

      await dbRun(
        db,
        `UPDATE feeds SET last_polled_at = ?, next_poll_at = ?, error_count = 0,
                          title = COALESCE(?, title), site_url = COALESCE(?, site_url)
         WHERE id = ?`,
        [now, now + FIVE_MINUTES_MS, parsed.title, parsed.siteUrl, feed.id],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[poll-youtube] Error polling ${feed.url}:`, errMsg);
      totalErrors++;
      const newErrorCount = (feed.error_count || 0) + 1;
      const backoffMs = Math.min(
        FIVE_MINUTES_MS * Math.pow(2, newErrorCount),
        24 * 60 * 60 * 1000,
      );
      await dbRun(
        db,
        `UPDATE feeds SET error_count = ?, next_poll_at = ?,
                          last_scrape_error = ?
         WHERE id = ?`,
        [newErrorCount, now + backoffMs, errMsg.slice(0, 500), feed.id],
      );
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
      JSON.stringify({ source: 'youtube', channels_polled: feeds.length, videos_new: totalNew, errors: totalErrors }),
      now,
      now,
    ],
  );
}
