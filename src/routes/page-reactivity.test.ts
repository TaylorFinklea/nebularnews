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
    hrefUnread: '/articles?read=unread&sort=unread_first',
    hrefHighFitUnread: '/articles?read=unread&sort=unread_first&score=5&score=4&score=3'
  },
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
});
