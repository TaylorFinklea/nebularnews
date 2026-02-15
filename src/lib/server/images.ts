import { DOMParser } from 'linkedom';

const IMAGE_META_SELECTORS = [
  'meta[property="og:image:secure_url"]',
  'meta[property="og:image:url"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image:src"]',
  'meta[name="twitter:image"]',
  'meta[itemprop="image"]',
  'link[rel="image_src"]'
];

const IMAGE_ATTRS = ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-actualsrc'];

const asDocument = (value: Document | { document?: Document }) => {
  if ('document' in value && value.document) return value.document;
  return value as Document;
};

const hasHtmlTag = (value: string) => /<[a-zA-Z!/][^>]*>/.test(value);

const wrapAsHtml = (value: string) => {
  if (/<html[\s>]/i.test(value)) return value;
  if (hasHtmlTag(value)) return `<html><body>${value}</body></html>`;
  return `<html><body>${value}</body></html>`;
};

const parseHtmlDocument = (html: string) => {
  try {
    const parsed = new DOMParser().parseFromString(wrapAsHtml(html), 'text/html') as Document | { document?: Document };
    const document = asDocument(parsed);
    return document.documentElement ? document : null;
  } catch {
    return null;
  }
};

const normalizeHttpUrl = (value: string | null | undefined, baseUrl?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const likelyDecorativeImage = (url: string) => {
  const normalized = url.toLowerCase();
  return (
    normalized.includes('/logo') ||
    normalized.includes('/icon') ||
    normalized.includes('/avatar') ||
    normalized.includes('/sprite') ||
    normalized.includes('gravatar.com/avatar')
  );
};

const srcFromSrcset = (value: string | null | undefined) => {
  if (!value) return null;
  const firstCandidate = value.split(',')[0]?.trim();
  if (!firstCandidate) return null;
  const [url] = firstCandidate.split(/\s+/);
  return url?.trim() || null;
};

const imageIsTooSmall = (img: Element) => {
  const width = Number.parseInt(img.getAttribute('width') ?? '', 10);
  const height = Number.parseInt(img.getAttribute('height') ?? '', 10);
  if (Number.isFinite(width) && width > 0 && width < 120) return true;
  if (Number.isFinite(height) && height > 0 && height < 120) return true;
  return false;
};

export const normalizeImageUrl = normalizeHttpUrl;

export function extractLeadImageUrlFromHtml(html: string, baseUrl?: string | null) {
  if (!html) return null;
  const document = parseHtmlDocument(html);
  if (!document) return null;

  for (const selector of IMAGE_META_SELECTORS) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const raw = node.getAttribute('content') ?? node.getAttribute('href');
    const normalized = normalizeHttpUrl(raw, baseUrl);
    if (normalized && !likelyDecorativeImage(normalized)) return normalized;
  }

  const root = document.querySelector('article, main, body') ?? document.body;
  if (!root) return null;
  const images = Array.from(root.querySelectorAll('img'));
  for (const image of images) {
    if (imageIsTooSmall(image)) continue;
    const srcsetValue = srcFromSrcset(image.getAttribute('srcset') ?? image.getAttribute('data-srcset'));
    const fromSrcset = normalizeHttpUrl(srcsetValue, baseUrl);
    if (fromSrcset && !likelyDecorativeImage(fromSrcset)) return fromSrcset;

    for (const attr of IMAGE_ATTRS) {
      const normalized = normalizeHttpUrl(image.getAttribute(attr), baseUrl);
      if (!normalized || likelyDecorativeImage(normalized)) continue;
      return normalized;
    }
  }

  return null;
}
