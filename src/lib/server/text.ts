import { Readability } from '@mozilla/readability';
import { DOMParser } from 'linkedom';

const stripWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const asDocument = (value: Document | { document?: Document }) => {
  if ('document' in value && value.document) return value.document;
  return value as Document;
};

const hasHtmlTag = (value: string) => /<[a-zA-Z!/][^>]*>/.test(value);

const wrapAsHtml = (value: string) => {
  if (/<html[\s>]/i.test(value)) return value;
  if (hasHtmlTag(value)) return `<html><body>${value}</body></html>`;
  return `<html><body>${escapeHtml(value)}</body></html>`;
};

const tryParseDocument = (html: string) => {
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html') as Document | { document?: Document };
    const document = asDocument(parsed);
    return document.documentElement ? document : null;
  } catch {
    return null;
  }
};

const parseHtmlDocument = (html: string) => {
  const wrapped = tryParseDocument(wrapAsHtml(html));
  if (wrapped) return wrapped;
  return tryParseDocument(html);
};

export function htmlToText(html: string) {
  if (!html) return '';
  const document = parseHtmlDocument(html);
  if (!document) return stripWhitespace(html);
  return stripWhitespace(document.body?.textContent ?? html);
}

export function extractMainContent(html: string, url?: string) {
  const document = parseHtmlDocument(html);
  if (!document) {
    const text = stripWhitespace(html);
    return {
      title: null,
      contentHtml: html,
      contentText: text,
      excerpt: text.slice(0, 300)
    };
  }
  if (url) {
    try {
      document.baseURI = url;
    } catch {
      // noop
    }
  }
  const reader = new Readability(document);
  const parsed = reader.parse();
  if (!parsed) {
    const text = stripWhitespace(document.body?.textContent ?? '');
    return {
      title: document.title ?? null,
      contentHtml: html,
      contentText: text,
      excerpt: text.slice(0, 300)
    };
  }
  const text = stripWhitespace(parsed.textContent ?? '');
  return {
    title: parsed.title ?? null,
    contentHtml: parsed.content ?? html,
    contentText: text,
    excerpt: parsed.excerpt ?? text.slice(0, 300)
  };
}

export function computeWordCount(text: string) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
