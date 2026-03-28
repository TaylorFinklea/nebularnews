import { json } from '@sveltejs/kit';
import { XMLParser } from 'fast-xml-parser';
import { nanoid } from 'nanoid';
import { dbGet, dbRun, now } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

const collectOutlines = (node: any, urls: Set<string>) => {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectOutlines(child, urls));
    return;
  }
  if (typeof node === 'object') {
    if (node.xmlUrl) urls.add(node.xmlUrl);
    if (node.outline) collectOutlines(node.outline, urls);
  }
};

export const POST = async ({ request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:write');

  const body = await request.json();
  const opml = body?.opml;
  if (!opml) return json({ error: 'Missing opml' }, { status: 400 });

  const data = parser.parse(opml);
  const urls = new Set<string>();
  collectOutlines(data?.opml?.body?.outline, urls);

  let added = 0;
  for (const url of urls) {
    try {
      new URL(url);
    } catch {
      continue;
    }
    const feedId = nanoid();
    const timestamp = now();
    await dbRun(
      locals.db,
      'INSERT INTO feeds (id, url, last_polled_at, next_poll_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [feedId, url, null, timestamp]
    );
    const existing = await dbGet<{ id: string }>(
      locals.db,
      'SELECT id FROM feeds WHERE url = ? LIMIT 1',
      [url]
    );
    if (existing) {
      await dbRun(
        locals.db,
        `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        [nanoid(), user.id, existing.id, timestamp]
      );
    }
    added += 1;
  }

  return json({ ok: true, added });
};
