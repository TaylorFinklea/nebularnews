// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArticlesPage from './+page.svelte';

vi.mock('$app/navigation', () => ({
  invalidateAll: vi.fn(async () => undefined)
}));

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
  reaction_reason_codes: [],
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
  selectedScores: ['5', '4', '3', '2', '1', 'learning', 'unscored'],
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
          reaction: { value: 1, reason_codes: ['up_interest_match'] }
        }
      })
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the reason dialog before saving a thumbs-up reaction', async () => {
    render(ArticlesPage, { data: createData() });
    const upButton = screen.getByRole('button', { name: 'Thumbs up feed' });

    expect(upButton.classList.contains('active')).toBe(false);
    await fireEvent.click(upButton);

    expect(screen.getByRole('dialog', { name: 'Why did you like this article?' })).toBeTruthy();
    expect(upButton.classList.contains('active')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves selected reason codes from the list reaction dialog', async () => {
    render(ArticlesPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up feed' }));
    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Matches my interests' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Good depth' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save reaction' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/reaction',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            value: 1,
            feedId: 'feed-1',
            reasonCodes: ['up_interest_match', 'up_good_depth']
          })
        })
      );
    });
  });

  it('saves an empty reason list when the user skips the dialog', async () => {
    render(ArticlesPage, { data: createData() });

    const downButton = screen.getByRole('button', { name: 'Thumbs down feed' });
    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs down feed' }));
    const dialog = screen.getByRole('dialog', { name: "Why didn't this work for you?" });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/reaction',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            value: -1,
            feedId: 'feed-1',
            reasonCodes: []
          })
        })
      );
      expect(downButton.classList.contains('active')).toBe(true);
    });
  });

  it('leaves the list row unchanged when the dialog is closed', async () => {
    render(ArticlesPage, { data: createData() });
    const upButton = screen.getByRole('button', { name: 'Thumbs up feed' });

    await fireEvent.click(upButton);
    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    await fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close reaction reason dialog' })[0]);

    expect(fetch).not.toHaveBeenCalled();
    expect(upButton.classList.contains('active')).toBe(false);
  });

  it('reopens an active reaction with saved reasons preselected', async () => {
    render(ArticlesPage, {
      data: createData({
        articles: [
          {
            ...baseArticle,
            reaction_value: 1,
            reaction_reason_codes: ['up_source_trust', 'up_good_timing']
          }
        ]
      })
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up feed' }));
    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });

    expect(within(dialog).getByRole('button', { name: 'Trust this source' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(within(dialog).getByRole('button', { name: 'Good timing' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByText('Trust this source')).toHaveLength(1);
  });

  it('renders insufficient-signal rows as learning instead of showing a numeric fit score', () => {
    render(ArticlesPage, {
      data: createData({
        articles: [
          {
            ...baseArticle,
            score: 3,
            score_status: 'insufficient_signal'
          }
        ]
      })
    });

    expect(screen.getByText('Learning')).toBeTruthy();
    expect(screen.queryByText('3/5')).toBeNull();
  });

  it('renders a dedicated learning score filter option', async () => {
    render(ArticlesPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: /Filters/i }));
    expect(screen.getByLabelText('Learning')).toBeTruthy();
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

    await fireEvent.click(upButton);
    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save reaction' }));

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
    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save reaction' }));
    await fireEvent.click(upButton);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(upButton.hasAttribute('disabled')).toBe(true);
    resolveFetch?.({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { reaction: { value: 1, reason_codes: [] } }
      })
    });
    await waitFor(() => expect(upButton.hasAttribute('disabled')).toBe(false));
  });
});
