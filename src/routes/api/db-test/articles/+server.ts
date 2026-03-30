import { json } from '@sveltejs/kit';

export const GET = async ({ locals }) => {
  try {
    const { listArticlesWithFilters, SCORE_VALUES, REACTION_VALUES } = await import('$lib/server/article-query');
    const result = await listArticlesWithFilters(locals.db, 'admin', {
      limit: 5,
      offset: 0,
      selectedScores: [...SCORE_VALUES],
      selectedReactions: [...REACTION_VALUES],
      readFilter: 'all',
      sort: 'newest',
      selectedTagIds: []
    });
    return json({ ok: true, count: result.articles.length, total: result.total });
  } catch (err) {
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined
    }, { status: 500 });
  }
};
