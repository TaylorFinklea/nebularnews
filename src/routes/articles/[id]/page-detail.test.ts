// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArticleDetailPage from './+page.svelte';

const invalidateAllMock = vi.hoisted(() => vi.fn(async () => undefined));
const mockedPage = vi.hoisted(() => {
  const listeners = new Set<(value: { url: URL }) => void>();
  let value = { url: new URL('https://example.com/articles/article-1?from=/articles') };

  return {
    page: {
      subscribe(run: (value: { url: URL }) => void) {
        run(value);
        listeners.add(run);
        return () => listeners.delete(run);
      }
    }
  };
});

vi.mock('$app/navigation', () => ({
  invalidateAll: invalidateAllMock
}));

vi.mock('$app/stores', () => ({
  page: mockedPage.page
}));

const createData = (overrides = {}) => ({
  article: {
    id: 'article-1',
    canonical_url: 'https://example.com/story',
    image_url: null,
    title: 'Article detail reason test',
    author: 'Test Author',
    published_at: Date.UTC(2026, 1, 28, 12, 0, 0),
    content_html: '',
    content_text: 'This is enough text to render the full article detail test without extra fallback behavior.',
    is_read: 1
  },
  summary: null,
  keyPoints: null,
  score: null,
  feedback: [],
  reaction: null,
  preferredSource: {
    feedId: 'feed-1',
    sourceName: 'Test Feed',
    reputation: 0,
    feedbackCount: 0
  },
  sources: [],
  tags: [],
  tagSuggestions: [],
  availableTags: [],
  autoReadDelayMs: 999999,
  ...overrides
});

describe('Article detail reaction reason flow', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
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
              reason_codes: ['up_interest_match']
            }
          }
        })
      }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends selected reason codes when saving a reaction from the detail page', async () => {
    render(ArticleDetailPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up this feed' }));

    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Matches my interests' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Good timing' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save reaction' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/reaction',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            value: 1,
            feedId: 'feed-1',
            reasonCodes: ['up_interest_match', 'up_good_timing']
          })
        })
      );
      expect(invalidateAllMock).toHaveBeenCalled();
    });
  });

  it('renders route-loaded reaction reasons in the detail utility panel', () => {
    render(
      ArticleDetailPage,
      {
        data: createData({
          reaction: {
            value: -1,
            feed_id: 'feed-1',
            created_at: 1234,
            reason_codes: ['down_source_distrust', 'down_too_shallow']
          }
        })
      }
    );

    expect(screen.getByText("Don't trust this source")).toBeTruthy();
    expect(screen.getByText('Too shallow')).toBeTruthy();
  });

  it('shows the sidebar learning state when the latest score is insufficient', () => {
    render(
      ArticleDetailPage,
      {
        data: createData({
          score: {
            score: 3,
            label: 'Algorithmic (17% confidence)',
            reason_text: 'Weighted average: 0.500',
            evidence: [],
            status: 'insufficient_signal'
          }
        })
      }
    );

    expect(screen.getByText('Learning your preferences. React to articles or refine tags to improve scoring.')).toBeTruthy();
    expect(screen.queryByText('3 / 5')).toBeNull();
  });

  it('keeps score explanation collapsed by default and expands on demand', async () => {
    render(
      ArticleDetailPage,
      {
        data: createData({
          score: {
            score: 3,
            label: 'Algorithmic (83% confidence)',
            reason_text: 'Weighted average: 0.562',
            evidence: ['topic_affinity: 0.550 (raw: 0.10)'],
            status: 'ready'
          }
        })
      }
    );

    expect(screen.getByText('3 / 5')).toBeTruthy();
    const leadScoreBanner = document.querySelector('.score-banner');
    expect(leadScoreBanner).toBeTruthy();
    expect(within(leadScoreBanner as HTMLElement).queryByText('Algorithmic (83% confidence)')).toBeNull();
    expect(within(leadScoreBanner as HTMLElement).queryByText('Weighted average: 0.562')).toBeNull();
    expect(within(leadScoreBanner as HTMLElement).queryByText('topic_affinity: 0.550 (raw: 0.10)')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Why this score' }));

    expect(within(leadScoreBanner as HTMLElement).getByText('Algorithmic (83% confidence)')).toBeTruthy();
    expect(within(leadScoreBanner as HTMLElement).getByText('Weighted average: 0.562')).toBeTruthy();
    expect(within(leadScoreBanner as HTMLElement).getByText('topic_affinity: 0.550 (raw: 0.10)')).toBeTruthy();
  });
});
