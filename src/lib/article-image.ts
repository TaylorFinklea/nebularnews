type ArticleImageInput = {
  id?: string | null;
  title?: string | null;
  source_name?: string | null;
  image_url?: string | null;
  tags?: Array<{ name?: string | null } | string> | null;
};

type UnsplashPreset = {
  url: string;
  tokens: string[];
};

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

const UNSPLASH_PRESETS: UnsplashPreset[] = [
  {
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
    tokens: ['space', 'astronomy', 'nasa', 'orbit', 'satellite', 'rocket', 'galaxy', 'planet']
  },
  {
    url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80',
    tokens: ['ai', 'robot', 'machine', 'llm', 'automation', 'neural', 'model']
  },
  {
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
    tokens: ['chip', 'semiconductor', 'hardware', 'gpu', 'cpu', 'electronics', 'nano']
  },
  {
    url: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1200&q=80',
    tokens: ['software', 'code', 'developer', 'programming', 'engineering', 'app', 'api']
  },
  {
    url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80',
    tokens: ['startup', 'product', 'web', 'saas', 'design']
  },
  {
    url: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80',
    tokens: ['finance', 'market', 'economy', 'stock', 'bank', 'business', 'trade']
  },
  {
    url: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80',
    tokens: ['health', 'medical', 'hospital', 'science', 'biotech', 'research']
  },
  {
    url: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1200&q=80',
    tokens: ['climate', 'environment', 'weather', 'earth', 'nature', 'energy']
  },
  {
    url: 'https://images.unsplash.com/photo-1432821596592-e2c18b78144f?auto=format&fit=crop&w=1200&q=80',
    tokens: ['media', 'news', 'journalism', 'press', 'publication']
  },
  {
    url: 'https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=1200&q=80',
    tokens: ['security', 'cyber', 'privacy', 'breach', 'encryption']
  },
  {
    url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
    tokens: ['city', 'transport', 'infrastructure', 'policy', 'urban']
  },
  {
    url: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=80',
    tokens: ['sports', 'game', 'league', 'football', 'basketball']
  },
  {
    url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80',
    tokens: ['education', 'learning', 'books', 'analysis']
  },
  {
    url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80',
    tokens: ['default', 'general', 'world']
  }
];

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
  const queryTokens = query.split(',').map((token) => token.trim()).filter(Boolean);

  let bestPreset = UNSPLASH_PRESETS[0];
  let bestScore = -1;
  for (const preset of UNSPLASH_PRESETS) {
    const score = preset.tokens.reduce((count, token) => {
      return count + (queryTokens.includes(token) ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestPreset = preset;
    }
  }

  // Stable tie-breaker so identical inputs pick the same image.
  if (bestScore <= 0) {
    const seed = stableHash(`${article.id ?? ''}|${query}`);
    bestPreset = UNSPLASH_PRESETS[seed % UNSPLASH_PRESETS.length];
  }

  return bestPreset.url;
}

export function resolveArticleImageUrl(article: ArticleImageInput) {
  if (article.image_url) return article.image_url;
  return buildUnsplashFallbackUrl(article);
}
