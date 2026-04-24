import { Hono } from 'hono';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun, dbBatch } from '../db/helpers';

export const feedRoutes = new Hono<AppEnv>();

interface Feed {
  id: string;
  url: string;
  title: string | null;
  site_url: string | null;
}

interface FeedWithSub extends Feed {
  sub_id: string;
  paused: number;
  max_articles_per_day: number | null;
  min_score: number | null;
  subscribed_at: number;
}

// GET /feeds — list user's subscribed feeds
feedRoutes.get('/feeds', async (c) => {
  const userId = c.get('userId');
  const rows = await dbAll<Record<string, unknown>>(
    c.env.DB,
    `SELECT f.id, f.url, f.title, f.site_url,
            f.last_polled_at, f.next_poll_at, f.error_count, f.disabled,
            f.scrape_mode, f.scrape_provider, f.feed_type,
            f.avg_extraction_quality, f.scrape_article_count, f.scrape_error_count, f.last_scrape_error,
            s.paused, s.max_articles_per_day, s.min_score,
            (SELECT COUNT(*) FROM article_sources src WHERE src.feed_id = f.id) as article_count
     FROM user_feed_subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ?`,
    [userId],
  );
  // Convert integer booleans to actual booleans for iOS Codable compatibility
  const feeds = rows.map((r: Record<string, unknown>) => ({
    ...r,
    paused: r.paused === 1,
    disabled: r.disabled,
  }));
  return c.json({ ok: true, data: feeds });
});

// Whitelist of scrape_mode values the client may set.
//   'rss_only'            → never deep-scrape
//   'auto_fetch_on_empty' → deep-scrape when RSS item has no usable body
//   'always'              → deep-scrape every item on ingestion
const ALLOWED_SCRAPE_MODES = new Set(['rss_only', 'auto_fetch_on_empty', 'always']);

// Effective default for newly created feeds. The column default in the initial
// schema is still 'rss_only' (changing a column default in SQLite requires a
// table rebuild), so every INSERT path must pass this value explicitly to
// actually land on the desired floor.
const DEFAULT_SCRAPE_MODE = 'auto_fetch_on_empty';

function sanitizeScrapeMode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return ALLOWED_SCRAPE_MODES.has(value) ? value : null;
}

// POST /feeds — subscribe to a feed by url
feedRoutes.post('/feeds', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ url: string; scrape_mode?: string; scrapeMode?: string }>();
  const url = body.url;
  const requestedMode = sanitizeScrapeMode(body.scrape_mode ?? body.scrapeMode);

  let feed = await dbGet<Feed>(c.env.DB, `SELECT * FROM feeds WHERE url = ?`, [url]);

  if (!feed) {
    const feedId = nanoid();
    await dbRun(
      c.env.DB,
      `INSERT INTO feeds (id, url, scrape_mode) VALUES (?, ?, ?)`,
      [feedId, url, requestedMode ?? DEFAULT_SCRAPE_MODE],
    );
    feed = { id: feedId, url, title: null, site_url: null };
  } else if (requestedMode) {
    // Upgrade the existing feed's scrape_mode if the caller asked for a more
    // capable mode (e.g. subscribing to a subreddit wants auto_fetch_on_empty,
    // but don't downgrade a feed an admin has set to 'always').
    await dbRun(
      c.env.DB,
      `UPDATE feeds SET scrape_mode = ?
       WHERE id = ? AND scrape_mode = 'rss_only'`,
      [requestedMode, feed.id],
    );
  }

  const subId = nanoid();
  const now = Date.now();
  await dbRun(
    c.env.DB,
    `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, feed_id) DO NOTHING`,
    [subId, userId, feed.id, now],
  );

  return c.json({ ok: true, data: { id: feed.id } });
});

// PATCH /feeds/:id — update feed-level settings (shared across all subscribers)
feedRoutes.patch('/feeds/:id', async (c) => {
  const feedId = c.req.param('id');
  const body = await c.req.json<{ scrape_mode?: string; scrapeMode?: string }>();
  const mode = sanitizeScrapeMode(body.scrape_mode ?? body.scrapeMode);

  if (!mode) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'scrape_mode must be one of rss_only, auto_fetch_on_empty, always' } }, 400);
  }

  // Gate on subscription so users can only touch feeds they follow.
  const userId = c.get('userId');
  const sub = await dbGet<{ id: string }>(
    c.env.DB,
    `SELECT id FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
    [userId, feedId],
  );
  if (!sub) {
    return c.json({ ok: false, error: { code: 'forbidden', message: 'Not subscribed to this feed' } }, 403);
  }

  await dbRun(c.env.DB, `UPDATE feeds SET scrape_mode = ? WHERE id = ?`, [mode, feedId]);
  return c.json({ ok: true, data: { id: feedId, scrape_mode: mode } });
});

// DELETE /feeds/:id — unsubscribe from a feed
feedRoutes.delete('/feeds/:id', async (c) => {
  const userId = c.get('userId');
  const feedId = c.req.param('id');
  await dbRun(
    c.env.DB,
    `DELETE FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
    [userId, feedId],
  );
  return c.json({ ok: true, data: null });
});

// Compute a compact ETag-style hash of a subscription's mutable fields so the
// client can detect concurrent edits via If-Match.
function subscriptionEtag(row: { paused: number; max_articles_per_day: number | null; min_score: number | null }): string {
  return `p${row.paused}m${row.max_articles_per_day ?? ''}n${row.min_score ?? ''}`;
}

// PATCH /feeds/:id/settings — update subscription settings.
// Optional `If-Match` header: if present, must equal the current ETag computed
// from (paused, max_articles_per_day, min_score). Mismatch returns 412 so the
// client can reconcile a stale offline edit.
feedRoutes.patch('/feeds/:id/settings', async (c) => {
  const userId = c.get('userId');
  const feedId = c.req.param('id');
  const ifMatch = c.req.header('If-Match');
  const body = await c.req.json<{
    paused?: boolean;
    maxArticlesPerDay?: number;
    minScore?: number;
  }>();

  if (ifMatch) {
    const current = await dbGet<{ paused: number; max_articles_per_day: number | null; min_score: number | null }>(
      c.env.DB,
      `SELECT paused, max_articles_per_day, min_score
         FROM user_feed_subscriptions
         WHERE user_id = ? AND feed_id = ?`,
      [userId, feedId],
    );
    if (!current) {
      return c.json({ ok: false, error: { code: 'not_found', message: 'No subscription' } }, 404);
    }
    const currentTag = subscriptionEtag(current);
    if (currentTag !== ifMatch) {
      return c.json(
        {
          ok: false,
          error: { code: 'precondition_failed', message: 'Subscription state changed since last read', current_etag: currentTag },
        },
        412,
      );
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.paused !== undefined) {
    sets.push('paused = ?');
    params.push(body.paused ? 1 : 0);
  }
  if (body.maxArticlesPerDay !== undefined) {
    sets.push('max_articles_per_day = ?');
    params.push(body.maxArticlesPerDay);
  }
  if (body.minScore !== undefined) {
    sets.push('min_score = ?');
    params.push(body.minScore);
  }

  if (sets.length === 0) return c.json({ ok: true, data: null });

  params.push(userId, feedId);
  await dbRun(
    c.env.DB,
    `UPDATE user_feed_subscriptions SET ${sets.join(', ')} WHERE user_id = ? AND feed_id = ?`,
    params,
  );

  const updated = await dbGet<{ paused: number; max_articles_per_day: number | null; min_score: number | null }>(
    c.env.DB,
    `SELECT paused, max_articles_per_day, min_score
       FROM user_feed_subscriptions
       WHERE user_id = ? AND feed_id = ?`,
    [userId, feedId],
  );
  const newEtag = updated ? subscriptionEtag(updated) : null;
  return c.json({ ok: true, data: { etag: newEtag } });
});

// POST /feeds/import-opml — bulk subscribe from OPML XML
feedRoutes.post('/feeds/import-opml', async (c) => {
  const userId = c.get('userId');
  const { xml } = await c.req.json<{ xml: string }>();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xml);

  const urls: string[] = [];
  const extract = (node: unknown) => {
    if (!node) return;
    const items = Array.isArray(node) ? node : [node];
    for (const item of items) {
      if (item['@_xmlUrl']) urls.push(item['@_xmlUrl']);
      if (item.outline) extract(item.outline);
    }
  };
  extract(doc?.opml?.body?.outline);

  const now = Date.now();
  const statements: { sql: string; params: unknown[] }[] = [];

  for (const url of urls) {
    const feedId = nanoid();
    statements.push({
      sql: `INSERT INTO feeds (id, url, scrape_mode) VALUES (?, ?, ?) ON CONFLICT (url) DO NOTHING`,
      params: [feedId, url, DEFAULT_SCRAPE_MODE],
    });
    const subId = nanoid();
    statements.push({
      sql: `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
            VALUES (?, ?, (SELECT id FROM feeds WHERE url = ?), ?)
            ON CONFLICT (user_id, feed_id) DO NOTHING`,
      params: [subId, userId, url, now],
    });
  }

  if (statements.length > 0) {
    await dbBatch(c.env.DB, statements);
  }

  return c.json({ ok: true, data: { added: urls.length } });
});

// GET /feeds/export-opml — export subscriptions as OPML
feedRoutes.get('/feeds/export-opml', async (c) => {
  const userId = c.get('userId');
  const rows = await dbAll<Feed>(
    c.env.DB,
    `SELECT f.id, f.url, f.title, f.site_url
     FROM user_feed_subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ?`,
    [userId],
  );

  const outlines = rows.map((f) => ({
    '@_type': 'rss',
    '@_text': f.title ?? f.url,
    '@_xmlUrl': f.url,
    '@_htmlUrl': f.site_url ?? '',
  }));

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
  });
  const xml = builder.build({
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    opml: {
      '@_version': '2.0',
      head: { title: 'NebularNews Subscriptions' },
      body: { outline: outlines },
    },
  });

  return c.json({ ok: true, data: { opml: xml } });
});

// POST /feeds/trigger-score — manually trigger algorithmic scoring
feedRoutes.post('/feeds/trigger-score', async (c) => {
  const { scoreArticles } = await import('../cron/score-articles');
  try {
    await scoreArticles(c.env);
    return c.json({ ok: true, data: { message: 'Scoring completed' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: { code: 'score_error', message: msg } }, 500);
  }
});

// POST /feeds/backfill-scrape — scrape existing articles from scrape-enabled feeds that lack content
feedRoutes.post('/feeds/backfill-scrape', async (c) => {
  const { scrapeAndExtract } = await import('../lib/scraper');
  const db = c.env.DB;
  const limit = 10; // process 10 at a time to stay within CPU limits

  const articles = await dbAll<{ id: string; canonical_url: string; feed_id: string; scrape_provider: string | null }>(
    db,
    `SELECT a.id, a.canonical_url, src.feed_id, f.scrape_provider
     FROM articles a
     JOIN article_sources src ON src.article_id = a.id
     JOIN feeds f ON f.id = src.feed_id
     WHERE f.scrape_mode != 'rss_only'
       AND (a.content_text IS NULL OR length(a.content_text) < 500)
       AND a.extraction_method IS NULL
     LIMIT ?`,
    [limit],
  );

  let scraped = 0;
  let errors = 0;
  for (const article of articles) {
    try {
      const result = await scrapeAndExtract(article.canonical_url, c.env, (article.scrape_provider as 'steel' | 'browserless' | null) || undefined);
      await dbRun(db,
        `UPDATE articles SET content_html = ?, content_text = ?, excerpt = ?,
          word_count = ?, extraction_method = ?, extraction_quality = ?,
          title = COALESCE(?, title), author = COALESCE(?, author),
          image_url = COALESCE(?, image_url)
         WHERE id = ?`,
        [result.contentHtml, result.contentText, result.excerpt,
         result.wordCount, result.extractionMethod, result.extractionQuality,
         result.title, result.author, result.imageUrl, article.id]);
      await dbRun(db,
        `UPDATE feeds SET scrape_article_count = scrape_article_count + 1,
          avg_extraction_quality = COALESCE(avg_extraction_quality * 0.9 + ? * 0.1, ?)
         WHERE id = ?`,
        [result.extractionQuality, result.extractionQuality, article.feed_id]);
      scraped++;
    } catch (err) {
      errors++;
      console.error(`[backfill-scrape] Failed ${article.canonical_url}:`, err instanceof Error ? err.message : err);
    }
  }

  return c.json({ ok: true, data: { candidates: articles.length, scraped, errors } });
});

// POST /feeds/trigger-pull — manually trigger feed polling
feedRoutes.post('/feeds/trigger-pull', async (c) => {
  const { pollFeeds } = await import('../cron/poll-feeds');
  try {
    await pollFeeds(c.env);
    return c.json({ ok: true, data: { message: 'Pull completed' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: { code: 'poll_error', message: msg } }, 500);
  }
});
