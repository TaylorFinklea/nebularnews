import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createSettingsState } from './settings-state';

vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => undefined)
}));

const baseData = {
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
    ingestModel: 'gpt-5-mini',
    ingestReasoningEffort: 'medium',
    chatProvider: 'openai',
    chatModel: 'gpt-5.2',
    chatReasoningEffort: 'medium',
    scoreSystemPrompt: 'sys',
    scoreUserPromptTemplate: 'user',
    summaryStyle: 'concise',
    summaryLength: 'short',
    initialFeedLookbackDays: 45,
    retentionDays: 0,
    retentionMode: 'archive',
    autoReadDelayMs: 4000,
    jobProcessorBatchSize: 12,
    articleCardLayout: 'split',
    dashboardQueueWindowDays: 7,
    dashboardQueueLimit: 6,
    dashboardQueueScoreCutoff: 3
  },
  keyMap: { openai: true, anthropic: false },
  profile: {
    profile_text: 'profile text',
    version: 1,
    updated_at: Date.now()
  },
  scorePromptDefaults: {
    scoreSystemPrompt: 'default sys',
    scoreUserPromptTemplate: 'default user'
  }
};

describe('settings-state', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: {} }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks dirty state and discard', () => {
    const state = createSettingsState(baseData as never);
    expect(get(state as never).hasUnsavedChanges).toBe(false);

    state.setDraftField('chatModel', 'gpt-5.3');
    expect(get(state as never).hasUnsavedChanges).toBe(true);

    state.discardChanges();
    const snapshot = get(state as never);
    expect(snapshot.hasUnsavedChanges).toBe(false);
    expect(snapshot.draft.chatModel).toBe('gpt-5.2');
  });

  it('saves settings and clears dirty flag', async () => {
    const state = createSettingsState(baseData as never);
    state.setDraftField('summaryLength', 'medium');

    await state.saveAllChanges();

    const snapshot = get(state as never);
    expect(snapshot.hasUnsavedChanges).toBe(false);
    expect(snapshot.saveMessage).toBe('Settings saved.');
  });
});
