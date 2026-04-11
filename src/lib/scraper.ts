import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScrapeProvider = 'steel' | 'browserless';

export interface ScrapeResult {
  html: string;
  title: string | null;
  author: string | null;
  contentHtml: string;
  contentText: string;
  excerpt: string | null;
  imageUrl: string | null;
  wordCount: number;
  extractionQuality: number;
  extractionMethod: string;
}

const SCRAPER_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function scrapeWithSteel(url: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.steel.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ url, wait_for: 'networkidle', format: ['html'] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Steel error ${res.status}: ${body}`);
    }
    const data = await res.json() as Record<string, string>;
    return data.content || data.html || '';
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeWithBrowserless(url: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);
  try {
    const res = await fetch(`https://chrome.browserless.io/content?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, waitFor: 'networkidle0' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Browserless error ${res.status}: ${body}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Readability extraction
// ---------------------------------------------------------------------------

interface ReadabilityResult {
  title: string | null;
  author: string | null;
  contentHtml: string;
  contentText: string;
  excerpt: string | null;
  imageUrl: string | null;
  wordCount: number;
}

function extractWithReadability(html: string, url: string): ReadabilityResult {
  const { document } = parseHTML(html);
  if (!document) {
    return { title: null, author: null, contentHtml: '', contentText: '', excerpt: null, imageUrl: null, wordCount: 0 };
  }

  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    return { title: null, author: null, contentHtml: '', contentText: '', excerpt: null, imageUrl: null, wordCount: 0 };
  }

  const contentText = article.textContent.replace(/\s+/g, ' ').trim();
  const wordCount = contentText.split(/\s+/).filter(Boolean).length;

  let imageUrl: string | null = null;
  const imgMatch = article.content?.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) {
    try { imageUrl = new URL(imgMatch[1], url).toString(); } catch { /* ignore */ }
  }

  return {
    title: article.title || null,
    author: article.byline || null,
    contentHtml: article.content || '',
    contentText,
    excerpt: article.excerpt || contentText.slice(0, 300),
    imageUrl,
    wordCount,
  };
}

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

function scoreExtractionQuality(extracted: ReadabilityResult, rawHtml: string): number {
  const signals = [
    Math.min(1, extracted.wordCount / 300),
    Math.min(1, (extracted.contentHtml.match(/<p[\s>]/gi) || []).length / 5),
    extracted.title ? 1 : 0,
    extracted.author ? 1 : 0,
    Math.min(1, (extracted.contentText.length / (rawHtml.length || 1)) * 5),
    extracted.imageUrl ? 1 : 0,
  ];
  return Math.round((signals.reduce((a, b) => a + b, 0) / signals.length) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function scrapeAndExtract(
  url: string,
  env: { STEEL_API_KEY?: string; BROWSERLESS_API_KEY?: string },
  preferredProvider?: ScrapeProvider | null,
): Promise<ScrapeResult> {
  const providers: Array<{ name: ScrapeProvider; fn: (u: string, k: string) => Promise<string>; key: string }> = [];

  const steelEntry = env.STEEL_API_KEY ? { name: 'steel' as ScrapeProvider, fn: scrapeWithSteel, key: env.STEEL_API_KEY } : null;
  const browserlessEntry = env.BROWSERLESS_API_KEY ? { name: 'browserless' as ScrapeProvider, fn: scrapeWithBrowserless, key: env.BROWSERLESS_API_KEY } : null;

  if (preferredProvider === 'steel' && steelEntry) {
    providers.push(steelEntry);
    if (browserlessEntry) providers.push(browserlessEntry);
  } else if (preferredProvider === 'browserless' && browserlessEntry) {
    providers.push(browserlessEntry);
    if (steelEntry) providers.push(steelEntry);
  } else {
    if (steelEntry) providers.push(steelEntry);
    if (browserlessEntry) providers.push(browserlessEntry);
  }

  if (providers.length === 0) {
    throw new Error('No scraping provider configured (set STEEL_API_KEY or BROWSERLESS_API_KEY)');
  }

  let lastError: Error | null = null;
  let html = '';
  let usedProvider: ScrapeProvider = providers[0].name;

  for (const provider of providers) {
    try {
      html = await provider.fn(url, provider.key);
      usedProvider = provider.name;
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[scraper] ${provider.name} failed for ${url}:`, lastError.message);
    }
  }

  if (lastError || !html) {
    throw lastError ?? new Error('All scraping providers failed');
  }

  const extracted = extractWithReadability(html, url);
  const quality = scoreExtractionQuality(extracted, html);

  return {
    html,
    title: extracted.title,
    author: extracted.author,
    contentHtml: extracted.contentHtml,
    contentText: extracted.contentText,
    excerpt: extracted.excerpt,
    imageUrl: extracted.imageUrl,
    wordCount: extracted.wordCount,
    extractionQuality: quality,
    extractionMethod: usedProvider,
  };
}
