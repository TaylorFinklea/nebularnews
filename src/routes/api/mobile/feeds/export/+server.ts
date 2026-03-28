import { dbAll } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';

export const GET = async ({ request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:read');

  const feeds = await dbAll<{ title: string | null; url: string }>(
    locals.db,
    `SELECT f.title, f.url FROM feeds f
     WHERE EXISTS (
       SELECT 1 FROM user_feed_subscriptions ufs
       WHERE ufs.feed_id = f.id AND ufs.user_id = ?
     )
     ORDER BY f.title ASC`,
    [user.id]
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
