import { listArticlesWithFilters, REACTION_VALUES, SCORE_VALUES } from '$lib/server/article-query';

const PAGE_SIZE = 40;

export const load = async ({ platform, url }) => {
  const requestedPage = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const initialOffset = (requestedPage - 1) * PAGE_SIZE;

  const firstPass = await listArticlesWithFilters(platform.env.DB, {
    query: '',
    limit: PAGE_SIZE,
    offset: initialOffset,
    selectedScores: [...SCORE_VALUES],
    selectedReactions: [...REACTION_VALUES],
    readFilter: 'all',
    sort: 'newest',
    selectedTagIds: [],
    savedOnly: true
  });

  const total = firstPass.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const result =
    offset === initialOffset
      ? firstPass
      : await listArticlesWithFilters(platform.env.DB, {
          query: '',
          limit: PAGE_SIZE,
          offset,
          selectedScores: [...SCORE_VALUES],
          selectedReactions: [...REACTION_VALUES],
          readFilter: 'all',
          sort: 'newest',
          selectedTagIds: [],
          savedOnly: true
        });

  return {
    articles: result.articles,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      start: total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
      end: Math.min(page * PAGE_SIZE, total)
    }
  };
};
