import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFeed } from '../feed-parser';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const mastodonXml = readFileSync(join(fixturesDir, 'mastodon-user-feed.xml'), 'utf8');
const hnXml = readFileSync(join(fixturesDir, 'hn-front-page.xml'), 'utf8');

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

  it('extracts items with title, link, and guid', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].title).toBe('Show HN: Something cool');
    expect(parsed.items[0].url).toBe('https://example.com/cool-thing');
    expect(parsed.items[0].guid).toBe('https://news.ycombinator.com/item?id=99999999');
    expect(parsed.items[1].guid).toBe('https://news.ycombinator.com/item?id=99999998');
  });

  it('extracts publication time', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.items[0].publishedAt).toBe(
      Date.parse('Mon, 11 May 2026 12:00:00 +0000'),
    );
  });
});
