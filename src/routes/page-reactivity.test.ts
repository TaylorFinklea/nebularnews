// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './+page.svelte';

const invalidateMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$app/navigation', () => ({
  invalidate: invalidateMock
}));

const baseQueueArticle = {
  id: 'article-1',
  canonical_url: 'https://example.com/article-1',
  image_url: null,
  title: 'Unread dashboard article',
  published_at: Date.UTC(2026, 1, 27, 12, 0, 0),
  fetched_at: Date.UTC(2026, 1, 27, 12, 0, 0),
  excerpt: 'Excerpt text',
  summary_text: 'Summary text',
  score: 4,
  label: 'Relevant',
  queue_reason: 'high_fit',
  source_name: 'Test Feed'
};

const createData = (overrides = {}) => ({
  isDev: false,
  hasFeeds: true,
  degraded: false,
  degradedReason: null,
  queueConfig: {
    windowDays: 7,
    limit: 6,
    scoreCutoff: 3,
    hrefUnread: '/articles?read=unread&sort=unread_first&reaction=up&reaction=none',
    hrefHighFitUnread: '/articles?read=unread&sort=unread_first&score=5&score=4&score=3&reaction=up&reaction=none',
    fromHref: '/articles?read=unread&sort=unread_first&reaction=up&reaction=none'
  },
  newsBrief: null,
  readingQueue: [baseQueueArticle],
  momentum: {
    unreadTotal: 7,
    unread24h: 2,
    unread7d: 7,
    highFitUnread7d: 4
  },
  ...overrides
});

describe('Dashboard page reactivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/live/heartbeat') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                degraded: false,
                pull: {
                  in_progress: false,
                  started_at: null,
                  completed_at: null,
                  run_id: null,
                  last_run_status: null,
                  last_error: null
                }
              }
            })
          };
        }

        if (url === '/api/articles/article-1/read' && init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                article_id: 'article-1',
                is_read: 1
              }
            })
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('optimistically removes an item when marking as read and revalidates dashboard data', async () => {
    render(DashboardPage, { data: createData() });

    // Flush initial heartbeat poll timer.
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText('Unread dashboard article')).toBeTruthy();

    const markReadButton = screen.getByRole('button', { name: 'Mark read' });
    await fireEvent.click(markReadButton);

    // Optimistic removal should hide the queue item immediately.
    expect(screen.queryByText('Unread dashboard article')).toBeNull();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/read',
        expect.objectContaining({ method: 'POST' })
      );
      expect(invalidateMock).toHaveBeenCalledWith('app:dashboard');
    });
  });

  it('uses the immediate dev pull endpoint locally', async () => {
    render(DashboardPage, { data: createData({ isDev: true }) });

    await vi.advanceTimersByTimeAsync(0);

    const pullButton = screen.getByRole('button', { name: 'Pull feeds now' });
    await fireEvent.click(pullButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/dev/pull',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('keeps the queued pull endpoint outside development', async () => {
    render(DashboardPage, { data: createData({ isDev: false }) });

    await vi.advanceTimersByTimeAsync(0);

    const pullButton = screen.getByRole('button', { name: 'Pull feeds now' });
    await fireEvent.click(pullButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/pull',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('renders a ready News Brief above the unread queue with source links', async () => {
    render(
      DashboardPage,
      {
        data: createData({
          newsBrief: {
            state: 'ready',
            title: 'News Brief',
            editionLabel: 'Morning edition',
            generatedAt: Date.UTC(2026, 2, 3, 14, 5, 0),
            windowHours: 48,
            scoreCutoff: 3,
            stale: false,
            nextScheduledAt: Date.UTC(2026, 2, 3, 23, 0, 0),
            bullets: [
              {
                text: 'OpenAI released a new model family.',
                sources: [{ articleId: 'article-1', title: 'Unread dashboard article', canonicalUrl: 'https://example.com/article-1' }]
              }
            ]
          }
        })
      }
    );

    await vi.advanceTimersByTimeAsync(0);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim());
    expect(headings.slice(0, 3)).toEqual(['Reading Momentum', 'News Brief', 'Top Unread · Last 7 Days']);
    expect(screen.getByText('OpenAI released a new model family.')).toBeTruthy();
    const briefSourceLink = screen
      .getAllByRole('link', { name: 'Unread dashboard article' })
      .find((link) => link.getAttribute('href') === '/articles/article-1?from=%2F');
    expect(briefSourceLink).toBeTruthy();
  });

  it('renders Reading Momentum above the unread queue without a news brief', async () => {
    render(DashboardPage, { data: createData({ newsBrief: null }) });

    await vi.advanceTimersByTimeAsync(0);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim());
    expect(headings.slice(0, 2)).toEqual(['Reading Momentum', 'Top Unread · Last 7 Days']);
  });
});
