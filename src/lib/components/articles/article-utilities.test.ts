// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ArticleUtilities from './ArticleUtilities.svelte';
import ArticleUtilitiesTestHarness from './ArticleUtilitiesTestHarness.svelte';

afterEach(() => {
  cleanup();
});

const baseProps = {
  article: { id: 'article-1', title: 'Reason capture article' },
  score: null,
  reaction: null,
  tags: [],
  tagSuggestions: [],
  availableTags: [],
  sources: [],
  rerunBusy: false,
  tagBusy: false,
  tagError: '',
  tagInput: '',
  feedback: [],
  isRead: false,
  readStateBusy: false
};

describe('ArticleUtilities reaction reasons', () => {
  it('opens the thumbs-up reason dialog and saves multiple selected reasons', async () => {
    render(ArticleUtilitiesTestHarness, { props: { props: baseProps } });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }));

    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Matches my interests' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Good depth' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save reaction' }));

    expect(JSON.parse(screen.getByTestId('react-detail').textContent ?? 'null')).toEqual({
      value: 1,
      reasonCodes: ['up_interest_match', 'up_good_depth']
    });
  });

  it('opens the thumbs-down reason dialog', async () => {
    render(ArticleUtilities, { props: baseProps });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs down' }));

    const dialog = screen.getByRole('dialog', { name: "Why didn't this work for you?" });
    expect(within(dialog).getByRole('button', { name: 'Off topic for me' })).toBeTruthy();
  });

  it('supports skipping reason selection', async () => {
    render(ArticleUtilitiesTestHarness, { props: { props: baseProps } });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs down' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(JSON.parse(screen.getByTestId('react-detail').textContent ?? 'null')).toEqual({
      value: -1,
      reasonCodes: []
    });
  });

  it('closes without dispatching when dismissed', async () => {
    render(ArticleUtilitiesTestHarness, { props: { props: baseProps } });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }));
    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Why did you like this article?' })).toBeNull();
    expect(screen.getByTestId('react-detail').textContent).toBe('');
  });

  it('renders saved reason pills when reaction exists', () => {
    render(ArticleUtilities, {
      props: {
        ...baseProps,
        reaction: {
          value: 1,
          feed_id: 'feed-1',
          created_at: 1234,
          reason_codes: ['up_interest_match', 'up_good_depth']
        }
      }
    });

    expect(screen.getByText('Matches my interests')).toBeTruthy();
    expect(screen.getByText('Good depth')).toBeTruthy();
  });

  it('renders the page without errors', () => {
    expect(() => render(ArticleUtilities, { props: baseProps })).not.toThrow();
  });
});
