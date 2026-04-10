import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RssItem {
  guid?: unknown;
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  author?: unknown;
  "dc:creator"?: unknown;
  description?: unknown;
  "content:encoded"?: unknown;
  content?: unknown;
  id?: unknown;
  "media:thumbnail"?: unknown;
  "media:content"?: unknown;
  "media:group"?: {
    "media:thumbnail"?: unknown;
    "media:content"?: unknown;
  };
  image?: unknown;
  enclosure?: unknown;
}

interface AtomEntry {
  id?: unknown;
  title?: unknown;
  link?: unknown;
  published?: unknown;
  updated?: unknown;
  author?: unknown;
  name?: unknown;
  content?: unknown;
  summary?: unknown;
  "media:thumbnail"?: unknown;
  "media:content"?: unknown;
}

interface RssChannel {
  title?: unknown;
  link?: unknown;
  item?: RssItem | RssItem[];
}

interface AtomFeed {
  title?: unknown;
  link?: unknown;
  entry?: AtomEntry | AtomEntry[];
}

interface ParsedXml {
  rss?: { channel?: RssChannel };
  feed?: AtomFeed;
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
});

const arrify = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const getText = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: string })["#text"];
    return typeof text === "string" ? text : null;
  }
  return null;
};

const pickLink = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const preferred =
      value.find((entry) => entry?.rel === "alternate" && entry?.href) ??
      value[0];
    return pickLink(preferred);
  }
  if (typeof value === "object") {
    const href = (value as { href?: string }).href;
    return href ?? null;
  }
  return null;
};

const pickUrlField = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = pickUrlField(entry);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const url = obj.url ?? obj.href ?? obj.src;
    if (typeof url === "string") return url;
    return null;
  }
  return null;
};

const normalizeHttpUrl = (
  raw: string | null | undefined,
  baseUrl?: string | null,
): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const looksLikeImageUrl = (value: string) =>
  /\.(?:avif|gif|jpe?g|png|webp|bmp|svg)(?:$|[?#])/i.test(value) ||
  value.includes("/photo-") ||
  value.includes("images.unsplash.com");

const likelyDecorativeImage = (url: string) => {
  const normalized = url.toLowerCase();
  return (
    normalized.includes("/logo") ||
    normalized.includes("/icon") ||
    normalized.includes("/avatar") ||
    normalized.includes("/sprite") ||
    normalized.includes("gravatar.com/avatar")
  );
};

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

/** Upgrade known low-res image URLs to higher resolution versions. */
const upgradeImageUrl = (url: string): string => {
  // BBC: standard/240/ -> standard/1024/
  if (url.includes("ichef.bbci.co.uk") && url.includes("/standard/240/")) {
    return url.replace("/standard/240/", "/standard/1024/");
  }
  // BBC: other small sizes
  if (url.includes("ichef.bbci.co.uk") && /\/standard\/\d{2,3}\//.test(url)) {
    return url.replace(/\/standard\/\d+\//, "/standard/1024/");
  }
  return url;
};

const pickRssImage = (
  item: RssItem,
  itemUrl: string | null,
): string | null => {
  const mediaCandidates = [
    item["media:thumbnail"],
    item["media:content"],
    item["media:group"]?.["media:thumbnail"],
    item["media:group"]?.["media:content"],
    item.image,
  ];

  for (const candidate of mediaCandidates) {
    const raw = pickUrlField(candidate);
    const normalized = normalizeHttpUrl(raw, itemUrl);
    if (normalized && !likelyDecorativeImage(normalized)) return upgradeImageUrl(normalized);
  }

  const enclosures = arrify(item.enclosure);
  for (const enclosure of enclosures) {
    const raw = pickUrlField(enclosure);
    if (!raw) continue;
    const enc = enclosure as Record<string, unknown> | null;
    const typeValue =
      typeof enc?.type === "string" ? enc.type.toLowerCase() : "";
    if (
      typeValue.startsWith("image/") ||
      !typeValue ||
      looksLikeImageUrl(raw)
    ) {
      const normalized = normalizeHttpUrl(raw, itemUrl);
      if (normalized && !likelyDecorativeImage(normalized)) return upgradeImageUrl(normalized);
    }
  }

  return null;
};

const pickAtomImage = (
  entry: AtomEntry,
  entryUrl: string | null,
): string | null => {
  const linkNodes = arrify(entry.link as AtomEntry["link"]);
  for (const link of linkNodes) {
    const lnk = link as Record<string, unknown> | null;
    const rel = typeof lnk?.rel === "string" ? lnk.rel.toLowerCase() : "";
    const type = typeof lnk?.type === "string" ? lnk.type.toLowerCase() : "";
    if (rel !== "enclosure") continue;
    const raw = pickUrlField(link);
    if (!raw) continue;
    if (type.startsWith("image/") || !type || looksLikeImageUrl(raw)) {
      const normalized = normalizeHttpUrl(raw, entryUrl);
      if (normalized && !likelyDecorativeImage(normalized)) return upgradeImageUrl(normalized);
    }
  }

  const mediaCandidates = [
    entry["media:thumbnail"],
    entry["media:content"],
  ];
  for (const candidate of mediaCandidates) {
    const raw = pickUrlField(candidate);
    const normalized = normalizeHttpUrl(raw, entryUrl);
    if (normalized && !likelyDecorativeImage(normalized)) return normalized;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const parseDate = (value: unknown): number | null => {
  const text = getText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
};

// ---------------------------------------------------------------------------
// Simple HTML-to-text (no DOM needed)
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseFeed(xml: string): ParsedFeed {
  const data = parser.parse(xml) as ParsedXml;

  // RSS 2.0
  if (data?.rss?.channel) {
    const channel = data.rss.channel;
    const items = arrify(channel.item).map((item: RssItem): FeedItem => {
      const contentHtml = getText(
        item["content:encoded"] ?? item.description ?? item.content,
      );
      const contentText = contentHtml ? htmlToText(contentHtml) : null;
      const itemUrl = getText(item.link);
      return {
        guid: getText(item.guid) ?? getText(item.id),
        title: getText(item.title),
        url: itemUrl,
        publishedAt: parseDate(
          item.pubDate ?? item.published ?? item.updated,
        ),
        author: getText(item.author ?? item["dc:creator"]),
        contentHtml,
        contentText,
        imageUrl: pickRssImage(item, itemUrl),
      };
    });
    return {
      title: getText(channel.title),
      siteUrl: getText(channel.link),
      items,
    };
  }

  // Atom
  if (data?.feed) {
    const feed = data.feed;
    const items = arrify(feed.entry).map((entry: AtomEntry): FeedItem => {
      const contentObj = entry.content as Record<string, unknown> | null | undefined;
      const summaryObj = entry.summary as Record<string, unknown> | null | undefined;
      const contentHtml = getText(
        contentObj?.["#text"] ??
          entry.content ??
          summaryObj?.["#text"] ??
          entry.summary,
      );
      const contentText = contentHtml ? htmlToText(contentHtml) : null;
      const entryUrl = pickLink(entry.link);
      return {
        guid: getText(entry.id),
        title: getText(entry.title),
        url: entryUrl,
        publishedAt: parseDate(entry.published ?? entry.updated),
        author: getText((entry.author as Record<string, unknown> | null)?.name ?? entry.author),
        contentHtml,
        contentText,
        imageUrl: pickAtomImage(entry, entryUrl),
      };
    });
    return {
      title: getText(feed.title),
      siteUrl: pickLink(feed.link),
      items,
    };
  }

  return { title: null, siteUrl: null, items: [] };
}
