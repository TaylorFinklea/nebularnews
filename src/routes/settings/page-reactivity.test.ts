// @vitest-environment jsdom
// @ts-nocheck
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './+page.svelte';

const invalidateAllMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('$app/navigation', () => ({
  invalidateAll: invalidateAllMock
}));

const createData = (overrides = {}) => ({
  settings: {
    featureLanes: {
      summaries: 'pipeline',
      scoring: 'pipeline',
      profileRefresh: 'pipeline',
      keyPoints: 'pipeline',
      autoTagging: 'pipeline',
      articleChat: 'chat',
      globalChat: 'chat'
    },
    ingestProvider: 'openai',
    ingestModel: 'gpt-4o-mini',
    ingestReasoningEffort: 'low',
    chatProvider: 'openai',
    chatModel: 'gpt-4o',
    chatReasoningEffort: 'medium',
    scoreSystemPrompt: 'Default system prompt',
    scoreUserPromptTemplate: 'Default user prompt',
    summaryStyle: 'concise',
    summaryLength: 'short',
    initialFeedLookbackDays: 45,
    maxFeedsPerPoll: 12,
    maxItemsPerPoll: 120,
    eventsPollMs: 15000,
    dashboardRefreshMinMs: 30000,
    retentionDays: 0,
    retentionMode: 'archive',
    autoReadDelayMs: 4000,
    autoTaggingEnabled: true,
    autoTagMaxPerArticle: 2,
    jobProcessorBatchSize: 6,
    jobsIntervalMinutes: 5,
    pollIntervalMinutes: 60,
    pullSlicesPerTick: 1,
    pullSliceBudgetMs: 8000,
    jobBudgetIdleMs: 8000,
    jobBudgetWhilePullMs: 3000,
    autoQueueTodayMissing: true,
    articleCardLayout: 'split',
    dashboardQueueWindowDays: 7,
    dashboardQueueLimit: 6,
    dashboardQueueScoreCutoff: 3
  },
  keyMap: {
    openai: false,
    anthropic: false
  },
  profile: {
    version: 4,
    updated_at: Date.UTC(2026, 1, 28, 18, 0, 0),
    profile_text: 'Profile text'
  },
  scorePromptDefaults: {
    scoreSystemPrompt: 'Default system prompt',
    scoreUserPromptTemplate: 'Default user prompt'
  },
  initialFeedLookbackRange: {
    min: 0,
    max: 365,
    default: 45
  },
  feedPollingRange: {
    maxFeedsPerPoll: {
      min: 1,
      max: 50,
      default: 12
    },
    maxItemsPerPoll: {
      min: 10,
      max: 250,
      default: 120
    },
    eventsPollMs: {
      min: 1000,
      max: 60000,
      default: 15000
    },
    dashboardRefreshMinMs: {
      min: 1000,
      max: 120000,
      default: 30000
    }
  },
  retentionRange: {
    min: 0,
    max: 365,
    default: 0
  },
  autoReadDelayRange: {
    min: 0,
    max: 60000
  },
  autoTagging: {
    default: true,
    maxPerArticle: {
      min: 1,
      max: 5,
      default: 2
    }
  },
  jobProcessorBatchRange: {
    min: 1,
    max: 20,
    default: 6
  },
  schedulerRange: {
    jobsIntervalMinutes: {
      min: 1,
      max: 60,
      default: 5
    },
    pollIntervalMinutes: {
      min: 5,
      max: 120,
      default: 60
    },
    pullSlicesPerTick: {
      min: 1,
      max: 5,
      default: 1
    },
    pullSliceBudgetMs: {
      min: 1000,
      max: 20000,
      default: 8000
    },
    jobBudgetIdleMs: {
      min: 1000,
      max: 20000,
      default: 8000
    },
    jobBudgetWhilePullMs: {
      min: 1000,
      max: 10000,
      default: 3000
    },
    autoQueueTodayMissingDefault: true
  },
  dashboardQueueRange: {
    windowDays: {
      min: 1,
      max: 30,
      default: 7
    },
    limit: {
      min: 1,
      max: 20,
      default: 6
    },
    scoreCutoff: {
      min: 1,
      max: 5,
      default: 3
    }
  },
  orphanCleanup: {
    orphanCount: 2,
    sampleArticleIds: ['article-1', 'article-2', 'article-3'],
    suggestedBatchSize: 200
  },
  ...overrides
});

const getSaveButtons = () => screen.getAllByRole('button', { name: 'Save changes' });
const getDiscardButtons = () => screen.getAllByRole('button', { name: 'Discard' });
const getEnabledSaveButton = () => getSaveButtons().find((button) => !button.hasAttribute('disabled'));
const getEnabledDiscardButton = () => getDiscardButtons().find((button) => !button.hasAttribute('disabled'));

describe('Settings page reactivity', () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.startsWith('/api/models?provider=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }],
            fetchedAt: Date.now()
          })
        };
      }

      if (url === '/api/settings') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      }

      if (url === '/api/profile') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      }

      if (url === '/api/settings/tag-suggestions/reset-dismissed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      }

      if (url === '/api/keys' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      }

      if (url === '/api/keys/openai' && init?.method === 'DELETE') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      }

      if (url === '/api/keys/rotate' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: {} })
        };
      }

      if (url === '/api/admin/orphans/preview') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              orphan_count: 5,
              sample_article_ids: ['article-9', 'article-10'],
              suggested_batch_size: 150
            }
          })
        };
      }

      if (url === '/api/admin/orphans/run' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              deleted_articles: 2,
              orphan_count_after: 3,
              has_more: true
            }
          })
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, data: {} })
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/settings');
  });

  it('renders sections in order and keeps only the first two open by default', () => {
    render(SettingsPage, { data: createData() });

    const sectionTitles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent?.trim())
      .filter((title) =>
        ['AI setup', 'Reading defaults', 'Profile & prompts', 'Provider keys', 'Intake & retention', 'Operations'].includes(
          title ?? ''
        )
      );

    expect(sectionTitles).toEqual([
      'AI setup',
      'Reading defaults',
      'Profile & prompts',
      'Provider keys',
      'Intake & retention',
      'Operations'
    ]);

    expect(screen.getByRole('button', { name: 'Collapse AI setup' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse Reading defaults' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Profile & prompts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Provider keys' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('Paste OpenAI key')).toBeNull();
  });

  it('marks the correct sections dirty and enables save after edits', async () => {
    render(SettingsPage, { data: createData() });

    await fireEvent.change(screen.getByRole('combobox', { name: 'Summary style' }), {
      target: { value: 'detailed' }
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Expand Profile & prompts' }));
    await fireEvent.input(screen.getByDisplayValue('Profile text'), {
      target: { value: 'Updated profile text' }
    });

    await waitFor(() => {
      expect(
        screen.getAllByText((_, node) => node?.textContent?.includes('2 sections changed') ?? false).length
      ).toBeGreaterThan(0);
      expect(
        within(screen.getByRole('button', { name: 'Open Reading defaults section' })).getByText('Changed')
      ).toBeTruthy();
      expect(
        within(screen.getByRole('button', { name: 'Open Profile & prompts section' })).getByText('Changed')
      ).toBeTruthy();
      expect(getSaveButtons().some((button) => !button.hasAttribute('disabled'))).toBe(true);
    });
  });

  it('opens a collapsed section from the overview shortcut', async () => {
    render(SettingsPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: 'Open Provider keys section' }));

    expect(screen.getByRole('button', { name: 'Collapse Provider keys' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Paste OpenAI key')).toBeTruthy();
  });

  it('opens the matching section from the location hash on load', async () => {
    window.history.pushState({}, '', '/settings#keys');

    render(SettingsPage, { data: createData() });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Collapse Provider keys' })).toBeTruthy();
      expect(screen.getByPlaceholderText('Paste OpenAI key')).toBeTruthy();
    });
  });

  it('discards changes and restores the saved values', async () => {
    render(SettingsPage, { data: createData() });

    const summaryStyle = screen.getByRole('combobox', { name: 'Summary style' });
    await fireEvent.change(summaryStyle, {
      target: { value: 'detailed' }
    });

    let discardButton;
    await waitFor(() => {
      discardButton = getEnabledDiscardButton();
      expect(discardButton).toBeTruthy();
    });
    await fireEvent.click(discardButton);

    expect(summaryStyle.value).toBe('concise');
    expect(screen.queryByText(/section changed/)).toBeNull();
    expect(getSaveButtons().every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('saves changes, clears dirty state, and keeps open sections open', async () => {
    render(SettingsPage, { data: createData() });

    await fireEvent.change(screen.getByRole('combobox', { name: 'Summary style' }), {
      target: { value: 'detailed' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Expand Profile & prompts' }));
    await fireEvent.input(screen.getByDisplayValue('Profile text'), {
      target: { value: 'Saved profile text' }
    });

    let saveButton;
    await waitFor(() => {
      saveButton = getEnabledSaveButton();
      expect(saveButton).toBeTruthy();
    });
    await fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'POST' }));
      expect(fetch).toHaveBeenCalledWith('/api/profile', expect.objectContaining({ method: 'POST' }));
      expect(invalidateAllMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole('button', { name: 'Collapse Profile & prompts' })).toBeTruthy();
    expect(screen.queryByText(/section changed/)).toBeNull();
  });

  it('keeps immediate key actions independent from the global save flow', async () => {
    render(SettingsPage, { data: createData({ keyMap: { openai: true, anthropic: false } }) });

    await fireEvent.click(screen.getByRole('button', { name: 'Open Provider keys section' }));
    await fireEvent.input(screen.getByPlaceholderText('Paste OpenAI key'), {
      target: { value: 'sk-test-openai' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save OpenAI key' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/keys', expect.objectContaining({ method: 'POST' }));
      expect(fetch).toHaveBeenCalledWith('/api/models?provider=openai', expect.anything());
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove OpenAI key' }).hasAttribute('disabled')).toBe(false);
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove OpenAI key' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/keys/openai', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  it('runs independent admin actions without relying on the global save button', async () => {
    render(SettingsPage, { data: createData() });

    await fireEvent.click(screen.getByRole('button', { name: 'Reset dismissed suggestions' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/settings/tag-suggestions/reset-dismissed',
        expect.objectContaining({ method: 'POST' })
      );
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Open Operations section' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/admin/orphans/preview', expect.anything());
      expect(screen.getByText('5')).toBeTruthy();
    });
  });
});
