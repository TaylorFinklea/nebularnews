// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ArticleCard from './ArticleCard.svelte';
import ArticleFilters from './ArticleFilters.svelte';

afterEach(() => {
  cleanup();
});

const article = {
  id: 'article-1',
  title: 'Article title',
  published_at: '2026-02-20T10:00:00.000Z',
  source_name: 'Feed One',
  source_feed_id: 'feed-1',
  is_read: 0,
  reaction_value: null,
  score: 4,
  tags: [{ id: 'tag-1', name: 'AI' }]
};

describe('ArticleCard', () => {
  it('renders article metadata and action controls', () => {
    render(ArticleCard, {
      props: {
        article,
        href: '/articles/article-1',
        cardLayout: 'split',
        pending: false,
        imageFailed: false
      }
    });

    expect(screen.getByRole('link', { name: 'Open article' })).toBeTruthy();
    expect(screen.getByText('Article title')).toBeTruthy();
    expect(screen.getByText('Feed One')).toBeTruthy();
    expect(screen.getByLabelText('Thumbs up feed')).toBeTruthy();
    expect(screen.getByLabelText('Thumbs down feed')).toBeTruthy();
    expect(screen.getByLabelText('Mark read')).toBeTruthy();
  });

  it('disables actions while pending', () => {
    render(ArticleCard, {
      props: {
        article,
        href: '/articles/article-1',
        cardLayout: 'split',
        pending: true,
        imageFailed: false
      }
    });

    expect(screen.getByLabelText('Thumbs up feed').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Thumbs down feed').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Mark read').hasAttribute('disabled')).toBe(true);
  });
});

describe('ArticleFilters', () => {
  it('retains selected values and supports reaction-all reset', async () => {
    const { container } = render(ArticleFilters, {
      props: {
        query: 'ai',
        selectedScores: ['5', '3'],
        readFilter: 'unread',
        sort: 'newest',
        view: 'list',
        selectedReactions: ['up'],
        selectedTagIds: ['tag-1'],
        availableTags: [
          { id: 'tag-1', name: 'AI', article_count: 12 },
          { id: 'tag-2', name: 'Security', article_count: 8 }
        ],
        clearHref: '/articles'
      }
    });

    expect((screen.getByPlaceholderText('Search headlines and summaries') as HTMLInputElement).value).toBe('ai');
    const readSelect = container.querySelector('select[name=\"read\"]') as HTMLSelectElement | null;
    expect(readSelect?.value).toBe('unread');

    const reactionUp = screen.getByRole('checkbox', { name: 'Up' }) as HTMLInputElement;
    const reactionNone = screen.getByRole('checkbox', { name: 'None' }) as HTMLInputElement;
    const reactionDown = screen.getByRole('checkbox', { name: 'Down' }) as HTMLInputElement;

    expect(reactionUp.checked).toBe(true);
    expect(reactionNone.checked).toBe(false);
    expect(reactionDown.checked).toBe(false);

    const reactionAllButton = container.querySelector('.reaction-all');
    expect(reactionAllButton).toBeTruthy();
    await fireEvent.click(reactionAllButton as Element);

    expect(reactionUp.checked).toBe(true);
    expect(reactionNone.checked).toBe(true);
    expect(reactionDown.checked).toBe(true);
    expect(screen.getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe('/articles');
  });
});
