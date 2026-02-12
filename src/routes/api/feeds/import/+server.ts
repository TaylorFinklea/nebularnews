import { json } from '@sveltejs/kit';
import { XMLParser } from 'fast-xml-parser';
import { nanoid } from 'nanoid';
import { dbRun, now } from '$lib/server/db';

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

export const POST = async ({ request, platform }) => {
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
    await dbRun(
      platform.env.DB,
      'INSERT OR IGNORE INTO feeds (id, url, last_polled_at, next_poll_at) VALUES (?, ?, ?, ?)',
      [nanoid(), url, null, now()]
    );
    added += 1;
  }

  return json({ ok: true, added });
};
