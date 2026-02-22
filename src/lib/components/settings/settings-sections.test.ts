// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import AISettingsSection from './AISettingsSection.svelte';
import BehaviorSection from './BehaviorSection.svelte';
import KeysSection from './KeysSection.svelte';
import PromptsSection from './PromptsSection.svelte';

afterEach(() => {
  cleanup();
});

const draft = {
  laneSummaries: 'pipeline',
  laneScoring: 'pipeline',
  laneProfileRefresh: 'pipeline',
  laneKeyPoints: 'pipeline',
  laneAutoTagging: 'pipeline',
  laneArticleChat: 'pipeline',
  laneGlobalChat: 'pipeline',
  ingestProvider: 'openai',
  ingestModel: 'gpt-5-mini',
  ingestReasoningEffort: 'low',
  chatProvider: 'openai',
  chatModel: 'gpt-5.2',
  chatReasoningEffort: 'medium',
  scoreSystemPrompt: 'system',
  scoreUserPromptTemplate: 'template',
  summaryStyle: 'concise',
  summaryLength: 'short',
  initialFeedLookbackDays: 45,
  retentionDays: 0,
  retentionMode: 'archive',
  autoReadDelayMs: 4000,
  jobProcessorBatchSize: 12,
  articleCardLayout: 'split',
  dashboardTopRatedLayout: 'split',
  dashboardTopRatedCutoff: 3,
  dashboardTopRatedLimit: 5,
  profileText: 'profile'
};

describe('Settings section components', () => {
  it('AISettingsSection emits field updates', async () => {
    const onSetField = vi.fn();

    const { container } = render(AISettingsSection, {
      draft,
      openaiModels: [{ id: 'gpt-5-mini', label: 'GPT-5 mini' }],
      anthropicModels: [{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' }],
      onSetField,
      onSyncModels: vi.fn(),
      modelStatus: () => '',
      isLoadingModels: () => false
    });

    const laneSummariesChat = container.querySelector('input[name="laneSummaries"][value="chat"]');
    expect(laneSummariesChat).toBeTruthy();
    await fireEvent.click(laneSummariesChat as Element);

    expect(onSetField).toHaveBeenCalledWith('laneSummaries', 'chat');
  });

  it('BehaviorSection emits numeric and select updates', async () => {
    const onSetField = vi.fn();

    render(BehaviorSection, {
      draft,
      ranges: {
        initialFeedLookback: { min: 0, max: 365, default: 45 },
        retention: { min: 0, max: 365, default: 0 },
        autoReadDelay: { min: 0, max: 120000 },
        dashboardTopRated: {
          cutoff: { min: 1, max: 5, default: 3 },
          limit: { min: 1, max: 20, default: 5 }
        },
        jobBatch: { min: 1, max: 100, default: 12 }
      },
      onSetField
    });

    await fireEvent.change(screen.getByRole('combobox', { name: 'Summary style' }), {
      target: { value: 'detailed' }
    });
    expect(onSetField).toHaveBeenCalledWith('summaryStyle', 'detailed');

    await fireEvent.input(screen.getByRole('spinbutton', { name: 'Job processor batch size' }), {
      target: { value: '20' }
    });
    expect(onSetField).toHaveBeenCalledWith('jobProcessorBatchSize', 20);
  });

  it('KeysSection emits key input and action callbacks', async () => {
    const onSetKeyInput = vi.fn();
    const onSaveKey = vi.fn();
    const onRemoveKey = vi.fn();
    const onRotateKeys = vi.fn();

    render(KeysSection, {
      keyMap: { openai: true, anthropic: false },
      keyInputs: { openai: '', anthropic: '' },
      onSetKeyInput,
      onSaveKey,
      onRemoveKey,
      onRotateKeys
    });

    await fireEvent.input(screen.getByPlaceholderText('Paste OpenAI key'), {
      target: { value: 'sk-test' }
    });
    expect(onSetKeyInput).toHaveBeenCalledWith('openai', 'sk-test');

    await fireEvent.click(screen.getByRole('button', { name: /save openai key/i }));
    expect(onSaveKey).toHaveBeenCalledWith('openai');

    await fireEvent.click(screen.getByRole('button', { name: 'Remove OpenAI key' }));
    expect(onRemoveKey).toHaveBeenCalledWith('openai');

    await fireEvent.click(screen.getByRole('button', { name: /rotate key ciphers/i }));
    expect(onRotateKeys).toHaveBeenCalledTimes(1);
  });

  it('PromptsSection emits prompt/profile updates and reset action', async () => {
    const onSetField = vi.fn();
    const onResetDefaults = vi.fn();

    render(PromptsSection, {
      draft,
      profile: {
        version: 4,
        updated_at: Date.now(),
        profile_text: 'profile'
      },
      onSetField,
      onResetDefaults
    });

    const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    await fireEvent.input(textareas[0], { target: { value: 'new-system' } });
    expect(onSetField).toHaveBeenCalledWith('scoreSystemPrompt', 'new-system');

    await fireEvent.input(textareas[2], { target: { value: 'new-profile' } });
    expect(onSetField).toHaveBeenCalledWith('profileText', 'new-profile');

    await fireEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(onResetDefaults).toHaveBeenCalledTimes(1);
  });
});
