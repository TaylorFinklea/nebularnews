export const MAX_CONTENT_LENGTH = 12_000;

export function truncateContent(text: string | null): string {
  if (!text) return '';
  return text.length > MAX_CONTENT_LENGTH
    ? text.slice(0, MAX_CONTENT_LENGTH)
    : text;
}

export function normalizeParagraphSummary(text: string): string {
  const withoutListMarkers = text
    .replace(/^\s*[-*\u2022]\s+/gm, '')
    .replace(/^\s*\d+[).]\s+/gm, '');
  return withoutListMarkers.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeKeyPoints(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split('\n')
        .map((line) => line.trim());

  const cleaned = raw
    .map((entry) => String(entry ?? '').trim())
    .map((entry) =>
      entry
        .replace(/^\s*[-*\u2022]\s*/, '')
        .replace(/^\s*\d+[).]\s*/, '')
        .trim(),
    )
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, 8);
}

export function normalizeTagName(value: unknown): string {
  return String(value ?? '')
    .replace(/^\s*[-*\u2022]\s*/, '')
    .replace(/^\s*\d+[).]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

export function normalizeTagConfidence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}
