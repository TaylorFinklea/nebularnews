// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArticleDetailPage from './+page.svelte';

const invalidateAllMock = vi.hoisted(() => vi.fn(async () => undefined));
const mockedPage = vi.hoisted(() => {
  const listeners = new Set();
  let value = { url: new URL('https://example.com/articles/article-1?from=%2Farticles%3Fread%3Dunread') };

  return {
    page: {
      subscribe(run) {
        run(value);
        listeners.add(run);
        return () => listeners.delete(run);
      }
    },
    setUrl(url) {
      value = { url: new URL(url) };
      for (const run of listeners) run(value);
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
    title: 'Article detail redesign test story',
    author: 'Reporter Name',
    published_at: '2026-02-26T15:30:00.000Z',
    content_html: '<p>Paragraph one.</p><p>Paragraph two.</p>',
    content_text: 'Paragraph one.\n\nParagraph two.',
    is_read: 0
  },
  summary: {
    summary_text: 'A compact explanation of the story.',
    provider: 'openai',
    model: 'gpt-test'
  },
  keyPoints: {
    points: ['First point', 'Second point'],
    provider: 'openai',
    model: 'gpt-test'
  },
  score: {
    score: 4,
    label: 'High fit',
    reason_text: 'Matches the topics you usually open.',
    evidence: ['Frequent AI topic overlap', 'Recent unread momentum']
  },
  feedback: [{ rating: 4, comment: 'Helpful', created_at: Date.now() }],
  reaction: { value: null, feed_id: 'feed-1', created_at: Date.now() },
  preferredSource: { sourceName: 'Feed One', feedId: 'feed-1', reputation: 0.7, feedbackCount: 12 },
  sources: [
    { sourceName: 'Feed One', reputation: 0.7, feedbackCount: 12 },
    { sourceName: 'Feed Two', reputation: 0.3, feedbackCount: 4 }
  ],
  tags: [
    { id: 'tag-1', name: 'AI', source: 'manual' },
    { id: 'tag-2', name: 'Security', source: 'ai' }
  ],
  tagSuggestions: [{ id: 'suggestion-1', name: 'Robotics', name_normalized: 'robotics' }],
  availableTags: [{ id: 'tag-1', name: 'AI' }, { id: 'tag-2', name: 'Security' }],
  chatReadiness: { canChat: true, reasons: [] },
  autoReadDelayMs: 4000,
  ...overrides
});

describe('Article detail page reactivity', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    if (!Element.prototype.animate) {
      Element.prototype.animate = vi.fn().mockImplementation(() => {
        const anim = {
          onfinish: null,
          cancel: vi.fn(),
          finish: vi.fn(),
          play: vi.fn(),
          pause: vi.fn(),
          reverse: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          finished: Promise.resolve()
        };
        queueMicrotask(() => {
          if (anim.onfinish) anim.onfinish();
        });
        return anim;
      });
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/articles/article-1/read' && init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: { article_id: 'article-1', is_read: 1 } }) };
        }
        if (url === '/api/articles/article-1/reaction' && init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: { reaction: { value: 1 } } }) };
        }
        if (url === '/api/articles/article-1/rerun' && init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (url === '/api/chat/threads' && init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ id: 'thread-1' }) };
        }
        if (url === '/api/chat/threads/thread-1/messages' && init?.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ response: 'Assistant reply' }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) };
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('updates read state from the lead controls and calls the read endpoint', async () => {
    render(ArticleDetailPage, { data: createData() });

    const markReadButton = screen.getByRole('button', { name: 'Mark read' });
    await fireEvent.click(markReadButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/read',
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(screen.getByRole('button', { name: 'Mark unread' })).toBeTruthy();
  });

  it('updates reaction state from the lead controls and calls the reaction endpoint', async () => {
    render(ArticleDetailPage, { data: createData() });

    const upButton = screen.getByRole('button', { name: 'Thumbs up feed' });
    await fireEvent.click(upButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/reaction',
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(upButton.classList.contains('active')).toBe(true);
  });

  it('opens the utilities sheet and reveals collapsed utility sections', async () => {
    render(ArticleDetailPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: 'Open utilities' }));
    const dialog = await screen.findByRole('dialog', { name: 'Utilities' });

    await fireEvent.click(within(dialog).getByRole('button', { name: /Tags/i }));
    expect(within(dialog).getByRole('button', { name: 'Add tags' })).toBeTruthy();

    await fireEvent.click(within(dialog).getByRole('button', { name: /AI Tools/i }));
    expect(within(dialog).getByRole('button', { name: 'Rebuild summary' })).toBeTruthy();

    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Utilities' })).toBeNull();
    });
  });

  it('keeps rerun controls inside the AI tools section', async () => {
    render(ArticleDetailPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: 'Open utilities' }));
    const dialog = await screen.findByRole('dialog', { name: 'Utilities' });
    await fireEvent.click(within(dialog).getByRole('button', { name: /AI Tools/i }));

    const rerunButton = within(dialog).getByRole('button', { name: 'Rebuild summary' });
    await fireEvent.click(rerunButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/articles/article-1/rerun',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
