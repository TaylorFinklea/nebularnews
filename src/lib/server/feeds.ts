import { XMLParser } from 'fast-xml-parser';
import { htmlToText } from './text';

export type FeedItem = {
  guid: string | null;
  title: string | null;
  url: string | null;
  publishedAt: number | null;
  author: string | null;
  contentHtml: string | null;
  contentText: string | null;
};

export type ParsedFeed = {
  title: string | null;
  siteUrl: string | null;
  items: FeedItem[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text'
});

const arrify = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const getText = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    const text = (value as { '#text'?: string })['#text'];
    return typeof text === 'string' ? text : null;
  }
  return null;
};

const pickLink = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const preferred = value.find((entry) => entry?.rel === 'alternate' && entry?.href) ?? value[0];
    return pickLink(preferred);
  }
  if (typeof value === 'object') {
    const href = (value as { href?: string }).href;
    return href ?? null;
  }
  return null;
};

const parseDate = (value: unknown): number | null => {
  const text = getText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
};

export function parseFeedXml(xml: string): ParsedFeed {
  const data = parser.parse(xml);
  if (data?.rss?.channel) {
    const channel = data.rss.channel;
    const items = arrify(channel.item).map((item: any) => {
      const contentHtml = getText(item['content:encoded'] ?? item.description ?? item.content);
      const contentText = contentHtml ? htmlToText(contentHtml) : null;
      return {
        guid: getText(item.guid) ?? getText(item.id),
        title: getText(item.title),
        url: getText(item.link),
        publishedAt: parseDate(item.pubDate ?? item.published ?? item.updated),
        author: getText(item.author ?? item['dc:creator']),
        contentHtml: contentHtml ?? null,
        contentText
      } satisfies FeedItem;
    });
    return {
      title: getText(channel.title),
      siteUrl: getText(channel.link),
      items
    };
  }

  if (data?.feed) {
    const feed = data.feed;
    const items = arrify(feed.entry).map((entry: any) => {
      const contentHtml = getText(entry.content?.['#text'] ?? entry.content ?? entry.summary?.['#text'] ?? entry.summary);
      const contentText = contentHtml ? htmlToText(contentHtml) : null;
      return {
        guid: getText(entry.id),
        title: getText(entry.title),
        url: pickLink(entry.link),
        publishedAt: parseDate(entry.published ?? entry.updated),
        author: getText(entry.author?.name ?? entry.author),
        contentHtml: contentHtml ?? null,
        contentText
      } satisfies FeedItem;
    });
    return {
      title: getText(feed.title),
      siteUrl: pickLink(feed.link),
      items
    };
  }

  return { title: null, siteUrl: null, items: [] };
}

export async function fetchAndParseFeed(url: string, etag?: string | null, lastModified?: string | null) {
  const headers: Record<string, string> = { 'user-agent': 'NebularNews/0.1 (+rss)' };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;

  const res = await fetch(url, { headers });
  if (res.status === 304) {
    return { notModified: true } as const;
  }
  if (!res.ok) {
    throw new Error(`Feed fetch failed: ${res.status}`);
  }
  const xml = await res.text();
  const parsed = parseFeedXml(xml);
  return {
    notModified: false,
    feed: parsed,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified')
  } as const;
}
