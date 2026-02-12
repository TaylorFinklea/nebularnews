import { describe, expect, it } from 'vitest';
import { parseFeedXml } from './feeds';

describe('parseFeedXml', () => {
  it('parses RSS items when description is plain text', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Example Feed</title>
          <link>https://example.com</link>
          <item>
            <guid>item-1</guid>
            <title>Hello</title>
            <link>https://example.com/post/1</link>
            <description>This is plain text.</description>
            <pubDate>Wed, 11 Feb 2026 10:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    const parsed = parseFeedXml(xml);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe('Hello');
    expect(parsed.items[0].contentText).toBe('This is plain text.');
  });
});
