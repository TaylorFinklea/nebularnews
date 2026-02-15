type ArticleImageInput = {
  id?: string | null;
  title?: string | null;
  source_name?: string | null;
  image_url?: string | null;
  tags?: Array<{ name?: string | null } | string> | null;
};

const FALLBACK_QUERY = 'technology,news';
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'its',
  'new',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'who',
  'will',
  'with'
]);

const stableHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const keywordTokens = (value: string | null | undefined) => {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
};

const pickQuery = (article: ArticleImageInput) => {
  const keywords = new Set<string>();
  for (const token of keywordTokens(article.title)) {
    keywords.add(token);
    if (keywords.size >= 4) break;
  }

  if (keywords.size < 2) {
    for (const tag of article.tags ?? []) {
      const value = typeof tag === 'string' ? tag : tag?.name ?? '';
      for (const token of keywordTokens(value)) {
        keywords.add(token);
        if (keywords.size >= 4) break;
      }
      if (keywords.size >= 4) break;
    }
  }

  if (keywords.size < 2) {
    for (const token of keywordTokens(article.source_name)) {
      keywords.add(token);
      if (keywords.size >= 4) break;
    }
  }

  if (keywords.size === 0) return FALLBACK_QUERY;
  return Array.from(keywords).join(',');
};

export function buildUnsplashFallbackUrl(article: ArticleImageInput) {
  const query = pickQuery(article);
  const seed = stableHash(`${article.id ?? ''}|${query}`) % 10000;
  return `https://source.unsplash.com/1200x675/?${encodeURIComponent(query)}&sig=${seed}`;
}

export function resolveArticleImageUrl(article: ArticleImageInput) {
  if (article.image_url) return article.image_url;
  return buildUnsplashFallbackUrl(article);
}
