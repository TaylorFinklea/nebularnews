import { json } from '@sveltejs/kit';

export const GET = async ({ locals }) => {
  try {
    const { listArticlesWithFilters, SCORE_VALUES, REACTION_VALUES } = await import('$lib/server/article-query');
    const userId = 'fdza0l143AQyRzy_WbIMW';
    const result = await listArticlesWithFilters(locals.db, userId, {
      limit: 5,
      offset: 0,
      selectedScores: [...SCORE_VALUES],
      selectedReactions: [...REACTION_VALUES],
      readFilter: 'all',
      sort: 'newest',
      selectedTagIds: []
    });
    const first = result.articles[0];
    return json({
      ok: true,
      count: result.articles.length,
      total: result.total,
      sample: first ? {
        id: first.id,
        title: first.title,
        is_read: first.is_read,
        is_read_type: typeof first.is_read,
        word_count: first.word_count,
        word_count_type: typeof first.word_count,
        score: first.score,
        score_type: typeof first.score,
        published_at: first.published_at,
        published_at_type: typeof first.published_at,
        fetched_at: first.fetched_at,
        fetched_at_type: typeof first.fetched_at,
        reaction_value: first.reaction_value,
        reaction_value_type: typeof first.reaction_value,
      } : null
    });
  } catch (err) {
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined
    }, { status: 500 });
  }
};
