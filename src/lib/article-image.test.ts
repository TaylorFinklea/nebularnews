import { describe, expect, it } from 'vitest';
import { buildUnsplashFallbackUrl, resolveArticleImageUrl } from './article-image';

describe('resolveArticleImageUrl', () => {
  it('prefers stored image url when present', () => {
    expect(resolveArticleImageUrl({ image_url: 'https://cdn.example.com/image.jpg' })).toBe(
      'https://cdn.example.com/image.jpg'
    );
  });

  it('returns deterministic unsplash fallback url for same article', () => {
    const first = buildUnsplashFallbackUrl({ id: 'a1', title: 'NASA launches new lunar rover mission' });
    const second = buildUnsplashFallbackUrl({ id: 'a1', title: 'NASA launches new lunar rover mission' });
    expect(first).toBe(second);
    expect(first).toContain('source.unsplash.com');
  });
});
