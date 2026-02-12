const STRIP_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'igshid'
]);

export function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    const params = new URLSearchParams(url.search);
    for (const key of Array.from(params.keys())) {
      if (key.startsWith('utm_') || STRIP_PARAMS.has(key)) params.delete(key);
    }
    url.search = params.toString();
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return raw;
  }
}
