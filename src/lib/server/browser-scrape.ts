export type BrowserScrapeProvider = 'browserless' | 'scrapingbee' | 'generic';

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
  options?: { timeoutMs?: number }
): Promise<BrowserScrapeResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (config.provider) {
      case 'browserless':
        return await fetchBrowserless(url, config, controller.signal);
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
