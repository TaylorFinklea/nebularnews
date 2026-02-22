<script>
  import { onMount } from 'svelte';
  import { IconDeviceFloppy, IconRestore } from '$lib/icons';
  import AISettingsSection from '$lib/components/settings/AISettingsSection.svelte';
  import BehaviorSection from '$lib/components/settings/BehaviorSection.svelte';
  import KeysSection from '$lib/components/settings/KeysSection.svelte';
  import PromptsSection from '$lib/components/settings/PromptsSection.svelte';
  import { createSettingsState } from '$lib/client/settings/settings-state';

  export let data;

  const settingsState = createSettingsState(data);

  const ranges = {
    initialFeedLookback: data.initialFeedLookbackRange,
    retention: data.retentionRange,
    autoReadDelay: data.autoReadDelayRange,
    dashboardTopRated: data.dashboardTopRatedRange,
    jobBatch: data.jobProcessorBatchRange
  };

  const setDraftField = (field, value) => {
    settingsState.setDraftField(field, value);
  };

  const setKeyInput = (provider, value) => {
    settingsState.setKeyInput(provider, value);
  };

  onMount(() => {
    settingsState.bootstrapModelSync();
  });
</script>

<section class="page-header">
  <div>
    <h1>Settings</h1>
    <p>Configure AI behavior, prompts, keys, and display defaults.</p>
    <nav class="settings-subnav" aria-label="Settings sections">
      <a href="#models">AI settings</a>
      <a href="#behavior">Behavior</a>
      <a href="#fit-score">Prompts</a>
      <a href="#keys">Keys</a>
      <a href="#profile">Profile</a>
    </nav>
  </div>
  <div class="header-actions">
    {#if $settingsState.saveError}
      <p class="save-status error" role="status" aria-live="polite">{$settingsState.saveError}</p>
    {:else if $settingsState.saveMessage}
      <p class="save-status" role="status" aria-live="polite">{$settingsState.saveMessage}</p>
    {:else if $settingsState.hasUnsavedChanges}
      <p class="save-status muted">Unsaved changes</p>
    {/if}
    <div class="row-actions">
      <button class="ghost inline-button" on:click={() => settingsState.discardChanges()} disabled={!$settingsState.hasUnsavedChanges || $settingsState.isSaving}>
        <IconRestore size={16} stroke={1.9} />
        <span>Discard</span>
      </button>
      <button on:click={() => settingsState.saveAllChanges()} class="inline-button" disabled={!$settingsState.hasUnsavedChanges || $settingsState.isSaving}>
        <IconDeviceFloppy size={16} stroke={1.9} />
        <span>{$settingsState.isSaving ? 'Saving...' : 'Save changes'}</span>
      </button>
    </div>
  </div>
</section>

<div class="settings-stack">
  <AISettingsSection
    draft={$settingsState.draft}
    openaiModels={$settingsState.models.openai.models}
    anthropicModels={$settingsState.models.anthropic.models}
    onSetField={setDraftField}
    onSyncModels={(provider) => settingsState.syncModels(provider)}
    modelStatus={(provider) => settingsState.modelStatus(provider)}
    isLoadingModels={(provider) => settingsState.isLoadingModels(provider)}
  />

  <BehaviorSection
    draft={$settingsState.draft}
    {ranges}
    onSetField={setDraftField}
  />

  <KeysSection
    keyMap={$settingsState.keyMap}
    keyInputs={$settingsState.keyInputs}
    onSetKeyInput={setKeyInput}
    onSaveKey={(provider) => settingsState.saveKey(provider)}
    onRemoveKey={(provider) => settingsState.removeKey(provider)}
    onRotateKeys={() => settingsState.rotateKeys()}
  />

  <PromptsSection
    draft={$settingsState.draft}
    profile={data.profile}
    onSetField={setDraftField}
    onResetDefaults={() => settingsState.resetScorePromptDefaults()}
  />
</div>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .header-actions {
    display: grid;
    gap: 0.5rem;
    justify-items: end;
    min-width: min(420px, 100%);
  }

  .settings-subnav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }

  .settings-subnav a {
    border: 1px solid var(--surface-border);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    font-size: 0.82rem;
    color: var(--muted-text);
    background: var(--surface-soft);
  }

  .save-status {
    margin: 0;
    font-size: 0.85rem;
    color: var(--primary);
  }

  .save-status.error {
    color: var(--danger);
  }

  .settings-stack {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }

  .muted {
    color: var(--muted-text);
    font-size: 0.85rem;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .header-actions .row-actions {
    justify-content: flex-end;
  }

  button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
    max-width: 100%;
    white-space: normal;
    line-height: 1.25;
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--ghost-border);
    color: var(--ghost-color);
  }

  .inline-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  @media (max-width: 900px) {
    .page-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      justify-items: start;
    }

    .header-actions .row-actions {
      justify-content: flex-start;
    }
  }
</style>
