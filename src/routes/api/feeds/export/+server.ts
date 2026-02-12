import { dbAll } from '$lib/server/db';

export const GET = async ({ platform }) => {
  const feeds = await dbAll<{ title: string | null; url: string }>(
    platform.env.DB,
    'SELECT title, url FROM feeds ORDER BY title ASC'
  );

  const outlines = feeds
    .map(
      (feed) =>
        `    <outline text="${escapeXml(feed.title ?? feed.url)}" type="rss" xmlUrl="${escapeXml(feed.url)}" />`
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Nebular News Feeds</title>\n  </head>\n  <body>\n${outlines}\n  </body>\n</opml>`;

  return new Response(body, {
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      'content-disposition': 'attachment; filename="nebular-news.opml"'
    }
  });
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
