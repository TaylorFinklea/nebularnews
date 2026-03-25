import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbGetMock = vi.fn();
const dbAllMock = vi.fn();
const listReactionReasonCodesForArticlesMock = vi.fn();
const getPreferredSourcesForArticlesMock = vi.fn();
const listTagsForArticlesMock = vi.fn();
const listTagSuggestionsForArticlesMock = vi.fn();

vi.mock('./db', () => ({
  dbGet: dbGetMock,
  dbAll: dbAllMock
}));

vi.mock('./reactions', () => ({
  listReactionReasonCodesForArticles: listReactionReasonCodesForArticlesMock
}));

vi.mock('./sources', () => ({
  getPreferredSourcesForArticles: getPreferredSourcesForArticlesMock
}));

vi.mock('./tags', () => ({
  listTagsForArticles: listTagsForArticlesMock,
  listTagSuggestionsForArticles: listTagSuggestionsForArticlesMock
}));

describe('article-query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbGetMock.mockResolvedValue({ count: 0 });
    dbAllMock.mockResolvedValue([]);
    listReactionReasonCodesForArticlesMock.mockResolvedValue(new Map());
    getPreferredSourcesForArticlesMock.mockResolvedValue(new Map());
    listTagsForArticlesMock.mockResolvedValue(new Map());
    listTagSuggestionsForArticlesMock.mockResolvedValue(new Map());
  });

  it('uses the article_search index for text queries and supports the learning score filter', async () => {
    const { listArticlesWithFilters } = await import('./article-query');

    await listArticlesWithFilters({} as D1Database, 'admin', {
      query: 'Puffin',
      limit: 20,
      offset: 0,
      selectedScores: ['learning'],
      selectedReactions: ['up', 'down', 'none'],
      readFilter: 'all',
      sort: 'newest',
      selectedTagIds: []
    });

    const [countSql, countParams] = [dbGetMock.mock.calls[0][1], dbGetMock.mock.calls[0][2]];
    expect(countSql).toContain('JOIN article_search ON article_search.article_id = a.id');
    expect(countSql).toContain('article_search MATCH ?');
    expect(countSql).toContain("score_status FROM article_scores");
    expect(countSql).toContain("= 'insufficient_signal'");
    expect(countParams).toEqual(['puffin']);
  });

  it('keeps unscored distinct from learning in score filters', async () => {
    const { listArticlesWithFilters } = await import('./article-query');

    await listArticlesWithFilters({} as D1Database, 'admin', {
      query: '',
      limit: 20,
      offset: 0,
      selectedScores: ['unscored'],
      selectedReactions: ['up', 'down', 'none'],
      readFilter: 'all',
      sort: 'newest',
      selectedTagIds: []
    });

    const countSql = dbGetMock.mock.calls[0][1] as string;
    expect(countSql).toContain("!= 'insufficient_signal'");
    expect(countSql).toContain('IS NULL');
  });
});
