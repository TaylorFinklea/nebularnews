import { XMLParser } from 'fast-xml-parser';
import { htmlToText } from './text';
import { extractLeadImageUrlFromHtml, normalizeImageUrl } from './images';

export type FeedItem = {
  guid: string | null;
  title: string | null;
  url: string | null;
  publishedAt: number | null;
  author: string | null;
  contentHtml: string | null;
  contentText: string | null;
  imageUrl: string | null;
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
const FEED_FETCH_TIMEOUT_MS = 12_000;

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

const looksLikeImageUrl = (value: string) =>
  /\.(?:avif|gif|jpe?g|png|webp|bmp|svg)(?:$|[?#])/i.test(value) ||
  value.includes('/photo-') ||
  value.includes('images.unsplash.com');

const pickUrlField = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = pickUrlField(entry);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === 'object') {
    const url = (value as { url?: string; href?: string; src?: string }).url;
    if (typeof url === 'string') return url;
    const href = (value as { url?: string; href?: string; src?: string }).href;
    if (typeof href === 'string') return href;
    const src = (value as { url?: string; href?: string; src?: string }).src;
    if (typeof src === 'string') return src;
    return null;
  }
  return null;
};

const pickRssImage = (item: any, itemUrl: string | null, contentHtml: string | null) => {
  const rssCandidates: string[] = [];
  const mediaCandidates = [
    item['media:thumbnail'],
    item['media:content'],
    item['media:group']?.['media:thumbnail'],
    item['media:group']?.['media:content'],
    item.image
  ];

  for (const candidate of mediaCandidates) {
    const raw = pickUrlField(candidate);
    if (raw) rssCandidates.push(raw);
  }

  const enclosures = arrify(item.enclosure);
  for (const enclosure of enclosures) {
    const raw = pickUrlField(enclosure);
    if (!raw) continue;
    const typeValue = typeof enclosure?.type === 'string' ? enclosure.type.toLowerCase() : '';
    if (typeValue.startsWith('image/') || !typeValue || looksLikeImageUrl(raw)) {
      rssCandidates.push(raw);
    }
  }

  for (const candidate of rssCandidates) {
    const normalized = normalizeImageUrl(candidate, itemUrl);
    if (normalized) return normalized;
  }

  if (contentHtml) {
    return extractLeadImageUrlFromHtml(contentHtml, itemUrl);
  }

  return null;
};

const pickAtomImage = (entry: any, entryUrl: string | null, contentHtml: string | null) => {
  const linkNodes = arrify(entry.link);
  for (const link of linkNodes) {
    const rel = typeof link?.rel === 'string' ? link.rel.toLowerCase() : '';
    const type = typeof link?.type === 'string' ? link.type.toLowerCase() : '';
    if (rel !== 'enclosure') continue;
    const raw = pickUrlField(link);
    if (!raw) continue;
    if (type.startsWith('image/') || !type || looksLikeImageUrl(raw)) {
      const normalized = normalizeImageUrl(raw, entryUrl);
      if (normalized) return normalized;
    }
  }

  const mediaCandidates = [entry['media:thumbnail'], entry['media:content'], entry['media:group']?.['media:content']];
  for (const candidate of mediaCandidates) {
    const raw = pickUrlField(candidate);
    const normalized = normalizeImageUrl(raw, entryUrl);
    if (normalized) return normalized;
  }

  if (contentHtml) {
    return extractLeadImageUrlFromHtml(contentHtml, entryUrl);
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
      const itemUrl = getText(item.link);
      return {
        guid: getText(item.guid) ?? getText(item.id),
        title: getText(item.title),
        url: itemUrl,
        publishedAt: parseDate(item.pubDate ?? item.published ?? item.updated),
        author: getText(item.author ?? item['dc:creator']),
        contentHtml: contentHtml ?? null,
        contentText,
        imageUrl: pickRssImage(item, itemUrl, contentHtml ?? null)
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
      const entryUrl = pickLink(entry.link);
      return {
        guid: getText(entry.id),
        title: getText(entry.title),
        url: entryUrl,
        publishedAt: parseDate(entry.published ?? entry.updated),
        author: getText(entry.author?.name ?? entry.author),
        contentHtml: contentHtml ?? null,
        contentText,
        imageUrl: pickAtomImage(entry, entryUrl, contentHtml ?? null)
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Feed fetch timed out after ${FEED_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
