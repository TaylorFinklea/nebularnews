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

// POST /feeds — subscribe to a feed by url
feedRoutes.post('/feeds', async (c) => {
  const userId = c.get('userId');
  const { url } = await c.req.json<{ url: string }>();

  let feed = await dbGet<Feed>(c.env.DB, `SELECT * FROM feeds WHERE url = ?`, [url]);

  if (!feed) {
    const feedId = nanoid();
    await dbRun(c.env.DB, `INSERT INTO feeds (id, url) VALUES (?, ?)`, [feedId, url]);
    feed = { id: feedId, url, title: null, site_url: null };
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

// PATCH /feeds/:id/settings — update subscription settings
feedRoutes.patch('/feeds/:id/settings', async (c) => {
  const userId = c.get('userId');
  const feedId = c.req.param('id');
  const body = await c.req.json<{
    paused?: boolean;
    maxArticlesPerDay?: number;
    minScore?: number;
  }>();

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
    const feedId = nanoid();
    statements.push({
      sql: `INSERT INTO feeds (id, url) VALUES (?, ?) ON CONFLICT (url) DO NOTHING`,
      params: [feedId, url],
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
