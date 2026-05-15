import { describe, it, expect } from 'vitest';
import { parseFeed } from '../feed-parser';

// Fixture: Mastodon user RSS feed (representative sample from hachyderm.io)
const mastodonXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:webfeeds="http://webfeeds.org/rss/1.0">
  <channel>
    <title>molly0xfff (@molly0xfff@hachyderm.io)</title>
    <description>Public posts from @molly0xfff@hachyderm.io</description>
    <link>https://hachyderm.io/@molly0xfff</link>
    <webfeeds:icon>https://hachyderm.io/system/accounts/avatars/000.png</webfeeds:icon>
    <item>
      <guid isPermaLink="true">https://hachyderm.io/@molly0xfff/111111111111111111</guid>
      <link>https://hachyderm.io/@molly0xfff/111111111111111111</link>
      <pubDate>Mon, 11 May 2026 14:32:00 +0000</pubDate>
      <description>&lt;p&gt;A sample Mastodon post body with HTML markup.&lt;/p&gt;</description>
    </item>
    <item>
      <guid isPermaLink="true">https://hachyderm.io/@molly0xfff/111111111111111112</guid>
      <link>https://hachyderm.io/@molly0xfff/111111111111111112</link>
      <pubDate>Mon, 11 May 2026 15:00:00 +0000</pubDate>
      <description>&lt;p&gt;A second post with &lt;a href="https://example.com"&gt;a link&lt;/a&gt;.&lt;/p&gt;</description>
      <media:thumbnail url="https://files.hachyderm.io/media_attachments/files/000/000/001/small/thumb.jpg" />
    </item>
  </channel>
</rss>`;

// Fixture: Hacker News front page RSS feed
const hnXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Hacker News</title>
    <link>https://news.ycombinator.com/</link>
    <description>Links for the intellectually curious, ranked by readers.</description>
    <item>
      <title>Show HN: Something cool</title>
      <link>https://example.com/cool-thing</link>
      <pubDate>Mon, 11 May 2026 12:00:00 +0000</pubDate>
      <comments>https://news.ycombinator.com/item?id=99999999</comments>
      <description>&lt;a href="https://news.ycombinator.com/item?id=99999999"&gt;Comments&lt;/a&gt;</description>
    </item>
    <item>
      <title>An interesting article about RSS</title>
      <link>https://blog.example.org/rss-is-cool</link>
      <pubDate>Mon, 11 May 2026 13:30:00 +0000</pubDate>
      <comments>https://news.ycombinator.com/item?id=99999998</comments>
      <description>&lt;a href="https://news.ycombinator.com/item?id=99999998"&gt;Comments&lt;/a&gt;</description>
    </item>
  </channel>
</rss>`;

describe('parseFeed — Mastodon user RSS', () => {
  it('parses the channel title', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.title).toContain('molly0xfff');
  });

  it('extracts both items', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.items).toHaveLength(2);
  });

  it('extracts URL, guid, and publication time per item', () => {
    const parsed = parseFeed(mastodonXml);
    const first = parsed.items[0];
    expect(first.url).toBe('https://hachyderm.io/@molly0xfff/111111111111111111');
    expect(first.guid).toBeTruthy();
    expect(first.publishedAt).toBe(Date.parse('Mon, 11 May 2026 14:32:00 +0000'));
  });

  it('extracts HTML body from <description>', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.items[0].contentHtml).toContain('sample Mastodon post');
    expect(parsed.items[0].contentText).toContain('sample Mastodon post');
  });

  it('extracts media:thumbnail when present', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.items[1].imageUrl).toMatch(/thumb\.jpg$/);
  });
});

describe('parseFeed — Hacker News front page', () => {
  it('parses the channel title', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.title).toBe('Hacker News');
  });

  it('extracts items with title and link', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].title).toBe('Show HN: Something cool');
    expect(parsed.items[0].url).toBe('https://example.com/cool-thing');
  });

  it('extracts publication time', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.items[0].publishedAt).toBe(
      Date.parse('Mon, 11 May 2026 12:00:00 +0000'),
    );
  });
});
