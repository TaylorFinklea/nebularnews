export type BrowserScrapeProvider = 'cloudflare' | 'steel' | 'browserless' | 'scrapingbee' | 'generic';

export type BrowserScrapeConfig = {
  provider: BrowserScrapeProvider;
  apiUrl: string;
  apiKey: string;
};

export type BrowserScrapeResult = {
  html: string;
  statusCode: number;
  provider: string;
};

const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchWithBrowser(
  url: string,
  config: BrowserScrapeConfig,
  options?: { timeoutMs?: number; browserBinding?: unknown }
): Promise<BrowserScrapeResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (config.provider === 'cloudflare') {
    if (!options?.browserBinding) {
      throw new Error('Cloudflare Browser Rendering requires the BROWSER binding');
    }
    return fetchCloudflare(url, options.browserBinding, timeoutMs);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (config.provider) {
      case 'browserless':
        return await fetchBrowserless(url, config, controller.signal);
      case 'steel':
        return await fetchSteel(url, config, controller.signal);
      case 'scrapingbee':
        return await fetchScrapingBee(url, config, controller.signal);
      case 'generic':
        return await fetchGeneric(url, config, controller.signal);
      default:
        throw new Error(`Unknown browser scrape provider: ${config.provider}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCloudflare(
  url: string,
  browserBinding: unknown,
  timeoutMs: number
): Promise<BrowserScrapeResult> {
  const puppeteer = (await import('@cloudflare/puppeteer')).default;
  const browser = await puppeteer.launch(browserBinding as Fetcher);
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: timeoutMs
    });
    const html = await page.content();
    const statusCode = response?.status() ?? 200;
    return { html, statusCode, provider: 'cloudflare' };
  } finally {
    await browser.close();
  }
}

async function fetchBrowserless(
  url: string,
  config: BrowserScrapeConfig,
  signal: AbortSignal
): Promise<BrowserScrapeResult> {
  const endpoint = `${config.apiUrl}/content?token=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, waitFor: 2000 }),
    signal
  });
  if (!res.ok) {
    throw new Error(`Browserless returned ${res.status}: ${await res.text()}`);
  }
  return { html: await res.text(), statusCode: res.status, provider: 'browserless' };
}

async function fetchScrapingBee(
  url: string,
  config: BrowserScrapeConfig,
  signal: AbortSignal
): Promise<BrowserScrapeResult> {
  const params = new URLSearchParams({
    api_key: config.apiKey,
    url,
    render_js: 'true',
    wait: '2000'
  });
  const res = await fetch(`${config.apiUrl}?${params}`, { signal });
  if (!res.ok) {
    throw new Error(`ScrapingBee returned ${res.status}: ${await res.text()}`);
  }
  return { html: await res.text(), statusCode: res.status, provider: 'scrapingbee' };
}

async function fetchSteel(
  url: string,
  config: BrowserScrapeConfig,
  signal: AbortSignal
): Promise<BrowserScrapeResult> {
  const endpoint = `${config.apiUrl}/v1/scrape`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ url }),
    signal
  });
  if (!res.ok) {
    throw new Error(`Steel returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { content?: string };
  const html = data.content ?? '';
  return { html, statusCode: res.status, provider: 'steel' };
}

async function fetchGeneric(
  url: string,
  config: BrowserScrapeConfig,
  signal: AbortSignal
): Promise<BrowserScrapeResult> {
  const res = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ url }),
    signal
  });
  if (!res.ok) {
    throw new Error(`Browser scrape provider returned ${res.status}: ${await res.text()}`);
  }
  return { html: await res.text(), statusCode: res.status, provider: 'generic' };
}
