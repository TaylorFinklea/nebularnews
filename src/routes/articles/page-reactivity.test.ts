// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArticlesPage from './+page.svelte';

const baseArticle = {
  id: 'article-1',
  canonical_url: 'https://example.com/story',
  image_url: null,
  title: 'Reactive UI test article',
  author: 'Test Author',
  published_at: '2026-02-15T12:00:00.000Z',
  fetched_at: '2026-02-15T12:00:00.000Z',
  excerpt: 'Article excerpt',
  summary_text: 'Article summary',
  is_read: 0,
  reaction_value: null,
  score: null,
  score_label: null,
  source_name: 'Test Feed',
  source_feed_id: 'feed-1',
  source_reputation: 0,
  source_feedback_count: 0,
  tags: []
};

const createData = (overrides: Record<string, unknown> = {}) => ({
  articles: [baseArticle],
  q: '',
  selectedScores: ['5', '4', '3', '2', '1', 'unscored'],
  readFilter: 'all',
  sort: 'newest',
  view: 'list',
  layout: 'split',
  selectedReactions: ['up', 'down', 'none'],
  availableTags: [],
  selectedTagIds: [],
  pagination: {
    page: 1,
    pageSize: 40,
    total: 1,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
    start: 1,
    end: 1
  },
  ...overrides
});

describe('Articles page reactivity', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          article_id: 'article-1',
          is_read: 1,
          reaction: { value: 1 }
        }
      })
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('updates thumb reaction state immediately after click', async () => {
    render(ArticlesPage, { data: createData() });
    const upButton = screen.getByRole('button', { name: 'Thumbs up feed' });

    expect(upButton.classList.contains('active')).toBe(false);
    await fireEvent.click(upButton);

    expect(upButton.classList.contains('active')).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/articles/article-1/reaction',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('updates read state immediately after marking read', async () => {
    render(ArticlesPage, { data: createData() });

    expect(screen.getByText('Unread')).toBeTruthy();
    const readButton = screen.getByRole('button', { name: 'Mark read' });
    await fireEvent.click(readButton);

    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark unread' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/articles/article-1/read',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('updates unread filter view immediately after marking read', async () => {
    render(ArticlesPage, {
      data: createData({
        readFilter: 'unread'
      })
    });

    const readButton = screen.getByRole('button', { name: 'Mark read' });
    await fireEvent.click(readButton);

    expect(screen.getByText('No articles yet. Add feeds to start pulling stories.')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/articles/article-1/read',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reverts optimistic state and shows toast on API failure', async () => {
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

    render(ArticlesPage, { data: createData() });
    const upButton = screen.getByRole('button', { name: 'Thumbs up feed' });

    expect(upButton.classList.contains('active')).toBe(false);
    await fireEvent.click(upButton);

    await waitFor(() => expect(upButton.classList.contains('active')).toBe(false));
    expect(screen.getByRole('status').textContent ?? '').toContain('Unable to save feed reaction');
  });

  it('dedupes repeated clicks while a request is pending', async () => {
    let resolveFetch: ((value: { ok: boolean }) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );

    render(ArticlesPage, { data: createData() });
    const upButton = screen.getByRole('button', { name: 'Thumbs up feed' });

    await fireEvent.click(upButton);
    await fireEvent.click(upButton);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(upButton.hasAttribute('disabled')).toBe(true);
    resolveFetch?.({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { reaction: { value: 1 } }
      })
    });
    await waitFor(() => expect(upButton.hasAttribute('disabled')).toBe(false));
  });
});
