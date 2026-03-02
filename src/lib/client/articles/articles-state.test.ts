import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, type Readable } from 'svelte/store';
import { createArticlesState, getVisibleArticles, normalizeArticle } from './articles-state';
import type { ArticlesUiState } from './types';

const baseArticle = {
  id: 'article-1',
  title: 'Test article',
  is_read: 0,
  reaction_value: null,
  reaction_reason_codes: [],
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
    const normalized = normalizeArticle({
      ...baseArticle,
      is_read: true,
      reaction_value: '1',
      reaction_reason_codes: ['up_interest_match']
    } as never);
    expect(normalized.is_read).toBe(1);
    expect(normalized.reaction_value).toBe(1);
    expect(normalized.reaction_reason_codes).toEqual(['up_interest_match']);
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

    const snapshot = get(state as unknown as Readable<ArticlesUiState>);
    const visible = getVisibleArticles(snapshot, {
      selectedScores: ['5', '4', '3', '2', '1', 'unscored'],
      selectedReactions: ['up', 'down', 'none'],
      selectedTagIds: [],
      readFilter: 'unread'
    });
    expect(visible.length).toBe(0);
  });

  it('reverts reaction and reason codes on failed mutation', async () => {
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
    await state.reactToArticle('article-1', 1, null, ['up_source_trust'], { optimisticEnabled: true });

    const merged = state.getMergedArticles()[0];
    const snapshot = get(state as unknown as Readable<ArticlesUiState>);
    expect(merged.reaction_value).toBe(null);
    expect(merged.reaction_reason_codes).toEqual([]);
    expect(snapshot.uiMessage).toContain('Unable to save feed reaction');
  });

  it('stores server reason codes after a successful reaction mutation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: {
            reaction: {
              value: 1,
              reason_codes: ['up_interest_match', 'up_good_depth']
            }
          }
        })
      }))
    );

    const state = createArticlesState([{ ...baseArticle }]);
    await state.reactToArticle('article-1', 1, null, ['up_good_depth', 'up_interest_match'], {
      optimisticEnabled: true
    });

    const merged = state.getMergedArticles()[0];
    expect(merged.reaction_value).toBe(1);
    expect(merged.reaction_reason_codes).toEqual(['up_interest_match', 'up_good_depth']);
  });
});
