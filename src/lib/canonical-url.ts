// Deterministic URL canonicalization for story-level dedup.
//
// Two URLs that point to the same story (modulo tracking params, www
// prefix, http vs https, query order, fragment, trailing slash) canonicalize
// to the same string. Used at INSERT time on every article so the LLM's
// `get_recent` view can collapse "same story from 4 sources" into one entry.
//
// Conservative on purpose: URL transforms only, no title/content similarity.
// Misses cases like "Substack republishes RSS post with a different URL,"
// which is acceptable in exchange for zero false-positive risk.

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 's', 'igshid', '_ga',
]);

function lowFallback(input: string): string {
  // For non-URL canonical strings like `mid:<message-id>` from email
  // articles. Lowercase + trailing-slash trim is enough — Message-Ids are
  // already globally unique.
  return input.toLowerCase().replace(/\/+$/, '');
}

export function canonicalizeUrl(rawUrl: string): string {
  const input = (rawUrl ?? '').trim();
  if (!input) return '';

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return lowFallback(input);
  }

  // Only apply URL normalization to http/https schemes.
  // Other schemes (mid:, mailto:, etc.) fall through to the low-effort path.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return lowFallback(input);
  }

  // Lowercase host, drop leading "www."
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  url.hostname = host;

  // Normalize scheme.
  if (url.protocol === 'http:') url.protocol = 'https:';

  // Strip tracking params and sort the remainder alphabetically.
  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('utm_')) continue;
    if (TRACKING_PARAMS.has(key)) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  // Rebuild search string deterministically.
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);

  // Drop fragment.
  url.hash = '';

  // Drop trailing slash from path (except when path is just "/").
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
