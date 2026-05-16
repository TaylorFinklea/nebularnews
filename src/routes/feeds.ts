import { Hono } from 'hono';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun, dbBatch } from '../db/helpers';
import { detectSource } from '../lib/source-detect';

export const feedRoutes = new Hono<AppEnv>();

interface Feed {
  id: string;
  url: string;
  title: string | null;
  site_url: string | null;
}

// Whitelist of scrape_mode values the client may set.
const ALLOWED_SCRAPE_MODES = new Set(['rss_only', 'auto_fetch_on_empty', 'always']);
const DEFAULT_SCRAPE_MODE = 'auto_fetch_on_empty';

function sanitizeScrapeMode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return ALLOWED_SCRAPE_MODES.has(value) ? value : null;
}

// GET /feeds — list user's subscribed feeds
feedRoutes.get('/feeds', async (c) => {
  const userId = c.get('userId');
  const rows = await dbAll<Record<string, unknown>>(
    c.env.DB,
    `SELECT f.id, f.url, f.title, f.site_url,
            f.last_polled_at, f.next_poll_at, f.error_count, f.disabled,
            f.scrape_mode, f.scrape_provider, f.feed_type,
            (SELECT COUNT(*) FROM article_sources src WHERE src.feed_id = f.id) as article_count
     FROM user_feed_subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ?`,
    [userId],
  );
  return c.json({ ok: true, data: rows });
});

// POST /feeds — subscribe to a feed. Body accepts:
//   { url: <RSS URL> }                     (legacy)
//   { source: <RSS URL | r/sub | UC… | substack URL>, source_type?: <override> }
feedRoutes.post('/feeds', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    url?: string;
    source?: string;
    source_type?: 'rss' | 'reddit' | 'youtube' | 'substack';
    scrape_mode?: string;
    scrapeMode?: string;
  }>();

  const rawInput = body.source ?? body.url ?? '';
  if (!rawInput) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'source or url is required' } }, 400);
  }

  const detected = await detectSource(rawInput);
  if ('error' in detected) {
    return c.json({ ok: false, error: { code: 'bad_request', message: detected.error } }, 400);
  }
  const sourceType = body.source_type ?? detected.type;
  const storedUrl = detected.url;

  const requestedMode = sanitizeScrapeMode(body.scrape_mode ?? body.scrapeMode);

  let feed = await dbGet<Feed>(
    c.env.DB,
    `SELECT * FROM feeds WHERE source_type = ? AND url = ?`,
    [sourceType, storedUrl],
  );

  if (!feed) {
    const feedId = nanoid();
    await dbRun(
      c.env.DB,
      `INSERT INTO feeds (id, url, source_type, scrape_mode) VALUES (?, ?, ?, ?)`,
      [feedId, storedUrl, sourceType, requestedMode ?? DEFAULT_SCRAPE_MODE],
    );
    feed = { id: feedId, url: storedUrl, title: null, site_url: null };
  } else if (requestedMode) {
    await dbRun(
      c.env.DB,
      `UPDATE feeds SET scrape_mode = ? WHERE id = ? AND scrape_mode = 'rss_only'`,
      [requestedMode, feed.id],
    );
  }

  await dbRun(
    c.env.DB,
    `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, feed_id) DO NOTHING`,
    [nanoid(), userId, feed.id, Date.now()],
  );

  return c.json({ ok: true, data: { id: feed.id, source_type: sourceType } });
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
    statements.push({
      sql: `INSERT INTO feeds (id, url, scrape_mode) VALUES (?, ?, ?) ON CONFLICT (url) DO NOTHING`,
      params: [nanoid(), url, DEFAULT_SCRAPE_MODE],
    });
    statements.push({
      sql: `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
            VALUES (?, ?, (SELECT id FROM feeds WHERE url = ?), ?)
            ON CONFLICT (user_id, feed_id) DO NOTHING`,
      params: [nanoid(), userId, url, now],
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
