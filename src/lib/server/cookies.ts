export const getCookieValue = (cookieHeader: string | null | undefined, name: string): string | null => {
  if (!cookieHeader) return null;
  const needle = `${name}=`;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const segment = part.trim();
    if (!segment.startsWith(needle)) continue;
    const value = segment.slice(needle.length);
    if (!value) return '';
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
};
