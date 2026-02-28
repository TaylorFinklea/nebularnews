// @vitest-environment jsdom
// @ts-nocheck
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ArticleDetailLead from './ArticleDetailLead.svelte';
import ArticleQuickTake from './ArticleQuickTake.svelte';
import ArticleUtilities from './ArticleUtilities.svelte';
import ChatBox from '$lib/components/ChatBox.svelte';

afterEach(() => {
  cleanup();
});

describe('Article detail components', () => {
  it('renders quick take summary, key points, and fit rationale disclosure', async () => {
    render(ArticleQuickTake, {
      props: {
        summaryText: 'Summary goes here.',
        keyPoints: ['Point one', 'Point two'],
        score: 4,
        scoreLabel: 'High fit',
        scoreReason: 'This topic matches your interests.',
        scoreEvidence: ['Evidence one', 'Evidence two']
      }
    });

    expect(screen.getByText('Summary goes here.')).toBeTruthy();
    expect(screen.getByText('Point one')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Why this fits/i }));
    expect(screen.getByText('Evidence one')).toBeTruthy();
  });

  it('omits the hero image when no article image is available', () => {
    render(ArticleDetailLead, {
      props: {
        backHref: '/articles',
        title: 'No image story',
        sourceName: 'Feed One',
        publishedLabel: 'Feb 28, 2026',
        isRead: false,
        reactionValue: null,
        leadTags: [],
        extraTagCount: 0,
        imageUrl: null
      }
    });

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders inspector section summary counts', () => {
    render(ArticleUtilities, {
      props: {
        layout: 'inspector',
        tags: [{ id: 'tag-1', name: 'AI' }, { id: 'tag-2', name: 'Security' }],
        tagSuggestions: [{ id: 'suggestion-1', name: 'Robotics' }],
        summary: { provider: 'openai', model: 'gpt-test' },
        keyPoints: { provider: 'openai', model: 'gpt-test' },
        score: { score: 4 },
        chatReadiness: { canChat: true, reasons: [] },
        feedbackCount: 2,
        sources: [{ sourceName: 'Feed One', reputation: 0.5, feedbackCount: 4 }],
        availableTags: []
      }
    });

    expect(screen.getByText('2 tags · 1 suggested')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('2 saved')).toBeTruthy();
    expect(screen.getByText('1 source')).toBeTruthy();
  });

  it('supports the compact chat variant', () => {
    const { container } = render(ChatBox, {
      props: {
        density: 'compact',
        chatLog: [],
        message: '',
        placeholder: 'Ask about this article'
      }
    });

    expect(container.querySelector('.chat-wrap')?.classList.contains('density-compact')).toBe(true);
    expect(screen.getByText('Ask about this article')).toBeTruthy();
  });
});
