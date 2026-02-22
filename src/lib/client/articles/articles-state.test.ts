import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createArticlesState, getVisibleArticles, normalizeArticle } from './articles-state';

const baseArticle = {
  id: 'article-1',
  title: 'Test article',
  is_read: 0,
  reaction_value: null,
  score: null,
  tags: []
};

describe('articles-state', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes article fields', () => {
    const normalized = normalizeArticle({ ...baseArticle, is_read: true, reaction_value: '1' });
    expect(normalized.is_read).toBe(1);
    expect(normalized.reaction_value).toBe(1);
  });

  it('updates unread visibility immediately after read mutation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: { article_id: 'article-1', is_read: 1 } })
      }))
    );

    const state = createArticlesState([{ ...baseArticle }]);
    await state.setReadState('article-1', true, { optimisticEnabled: true });

    const snapshot = get(state as never);
    const visible = getVisibleArticles(snapshot, {
      selectedScores: ['5', '4', '3', '2', '1', 'unscored'],
      selectedReactions: ['up', 'down', 'none'],
      selectedTagIds: [],
      readFilter: 'unread'
    });
    expect(visible.length).toBe(0);
  });

  it('reverts reaction and sets message on failed mutation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          ok: false,
          error: { code: 'internal_error', message: 'Unable to save feed reaction' }
        })
      }))
    );

    const state = createArticlesState([{ ...baseArticle }]);
    await state.reactToArticle('article-1', 1, null, { optimisticEnabled: true });

    const merged = state.getMergedArticles()[0];
    const snapshot = get(state as never);
    expect(merged.reaction_value).toBe(null);
    expect(snapshot.uiMessage).toContain('Unable to save feed reaction');
  });
});
