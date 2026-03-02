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
  chatReadiness: { canChat: false, reasons: [] },
  chatLog: [],
  message: '',
  sending: false,
  rerunBusy: false,
  tagBusy: false,
  tagError: '',
  tagInput: '',
  chatError: '',
  feedback: []
};

describe('ArticleUtilities reaction reasons', () => {
  it('opens the thumbs-up reason dialog and saves multiple selected reasons', async () => {
    render(ArticleUtilitiesTestHarness, { props: { props: baseProps } });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up this feed' }));

    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    expect(within(dialog).getByRole('button', { name: 'Matches my interests' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Trust this source' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Good timing' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Good depth' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Like this author' })).toBeTruthy();

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

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs down this feed' }));

    const dialog = screen.getByRole('dialog', { name: "Why didn't this work for you?" });
    expect(within(dialog).getByRole('button', { name: 'Off topic for me' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: "Don't trust this source" })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Too old / stale' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Too shallow' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Avoid this author' })).toBeTruthy();
  });

  it('supports skipping reason selection', async () => {
    render(ArticleUtilitiesTestHarness, { props: { props: baseProps } });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs down this feed' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(JSON.parse(screen.getByTestId('react-detail').textContent ?? 'null')).toEqual({
      value: -1,
      reasonCodes: []
    });
  });

  it('closes without dispatching when dismissed', async () => {
    render(ArticleUtilitiesTestHarness, { props: { props: baseProps } });

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up this feed' }));
    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Why did you like this article?' })).toBeNull();
    expect(screen.getByTestId('react-detail').textContent).toBe('');
  });

  it('renders saved reason pills and preselects them when reopening the active reaction', async () => {
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

    await fireEvent.click(screen.getByRole('button', { name: 'Thumbs up this feed' }));

    const dialog = screen.getByRole('dialog', { name: 'Why did you like this article?' });
    expect(within(dialog).getByRole('button', { name: 'Matches my interests' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(within(dialog).getByRole('button', { name: 'Good depth' }).getAttribute('aria-pressed')).toBe('true');
  });
});
