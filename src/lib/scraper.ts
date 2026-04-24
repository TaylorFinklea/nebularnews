import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { D1Database } from '@cloudflare/workers-types';
import { dbRun } from '../db/helpers';

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
      headers: { 'Content-Type': 'application/json', 'Steel-Api-Key': apiKey },
      body: JSON.stringify({ url, format: ['html'] }),
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
      body: JSON.stringify({ url }),
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
  let document: ReturnType<typeof parseHTML>['document'];
  try {
    ({ document } = parseHTML(html));
  } catch {
    return { title: null, author: null, contentHtml: '', contentText: '', excerpt: null, imageUrl: null, wordCount: 0 };
  }
  if (!document) {
    return { title: null, author: null, contentHtml: '', contentText: '', excerpt: null, imageUrl: null, wordCount: 0 };
  }

  const reader = new Readability(document as any);
  let article: ReturnType<typeof reader.parse> | null;
  try {
    article = reader.parse();
  } catch {
    return { title: null, author: null, contentHtml: '', contentText: '', excerpt: null, imageUrl: null, wordCount: 0 };
  }

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

  // If no browser providers available, fall back to simple fetch + Readability
  if (providers.length === 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'NebularNews/2.0 (+rss)' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const extracted = extractWithReadability(html, url);
      const quality = scoreExtractionQuality(extracted, html);
      return {
        html, title: extracted.title, author: extracted.author,
        contentHtml: extracted.contentHtml, contentText: extracted.contentText,
        excerpt: extracted.excerpt, imageUrl: extracted.imageUrl,
        wordCount: extracted.wordCount, extractionQuality: quality,
        extractionMethod: 'readability',
      };
    } finally {
      clearTimeout(timer);
    }
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
    // Fallback: simple fetch + Readability (no headless browser)
    console.log(`[scraper] Browser providers failed, falling back to Readability for ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'NebularNews/2.0 (+rss)' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
      usedProvider = 'readability' as any;
    } catch (fallbackErr) {
      throw lastError ?? fallbackErr ?? new Error('All scraping methods failed');
    } finally {
      clearTimeout(timer);
    }
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

// ---------------------------------------------------------------------------
// Shared persistence helper
//
// Both the poll-feeds cron (new-article path), the retry-empty-articles cron,
// and the admin rescrape route use this to keep the UPDATE shape consistent
// across callers. Feed-level stats (scrape_article_count, avg_extraction_quality)
// stay in callers because they vary: poll-feeds always updates them; the
// retry cron and admin path don't need to.
// ---------------------------------------------------------------------------

export interface ScrapeAndPersistResult {
  ok: boolean;
  scraped?: ScrapeResult;
  error?: string;
  attemptedAt: number;
}

export async function scrapeAndPersist(
  db: D1Database,
  env: { STEEL_API_KEY?: string; BROWSERLESS_API_KEY?: string },
  article: { id: string; canonical_url: string; preferredProvider?: ScrapeProvider | null },
): Promise<ScrapeAndPersistResult> {
  const now = Date.now();
  try {
    const result = await scrapeAndExtract(
      article.canonical_url,
      env,
      article.preferredProvider ?? undefined,
    );
    await dbRun(db,
      `UPDATE articles SET content_html = ?, content_text = ?, excerpt = ?,
         word_count = ?, extraction_method = ?, extraction_quality = ?,
         title = COALESCE(?, title), author = COALESCE(?, author),
         image_url = COALESCE(?, image_url),
         last_fetch_attempt_at = ?,
         fetch_attempt_count = COALESCE(fetch_attempt_count, 0) + 1,
         last_fetch_error = NULL
       WHERE id = ?`,
      [
        result.contentHtml, result.contentText, result.excerpt,
        result.wordCount, result.extractionMethod, result.extractionQuality,
        result.title, result.author, result.imageUrl,
        now, article.id,
      ],
    );
    return { ok: true, scraped: result, attemptedAt: now };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await dbRun(db,
      `UPDATE articles SET last_fetch_attempt_at = ?,
         fetch_attempt_count = COALESCE(fetch_attempt_count, 0) + 1,
         last_fetch_error = ?
       WHERE id = ?`,
      [now, errMsg.slice(0, 500), article.id],
    );
    return { ok: false, error: errMsg, attemptedAt: now };
  }
}
