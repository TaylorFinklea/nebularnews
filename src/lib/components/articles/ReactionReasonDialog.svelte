<script>
  import { createEventDispatcher } from 'svelte';
  import { getReasonOptionsForReaction } from '$lib/article-reactions';
  import Button from '$lib/components/Button.svelte';
  import { IconX } from '$lib/icons';

  export let open = false;
  export let value = 1;
  export let initialReasonCodes = [];

  const dispatch = createEventDispatcher();
  let selectedReasonCodes = [];
  let syncKey = '';

  const dialogTitle = (reactionValue) =>
    reactionValue === 1 ? 'Why did you like this article?' : "Why didn't this work for you?";

  const close = () => dispatch('close');

  const toggleReasonCode = (reasonCode) => {
    selectedReasonCodes = selectedReasonCodes.includes(reasonCode)
      ? selectedReasonCodes.filter((code) => code !== reasonCode)
      : [...selectedReasonCodes, reasonCode];
  };

  const save = () => {
    dispatch('save', {
      value,
      reasonCodes: [...selectedReasonCodes]
    });
  };

  const skip = () => {
    dispatch('skip', {
      value,
      reasonCodes: []
    });
  };

  const handleWindowKeydown = (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  $: reasonOptions = getReasonOptionsForReaction(value);
  $: nextSyncKey = `${open}:${value}:${JSON.stringify(initialReasonCodes ?? [])}`;
  $: if (nextSyncKey !== syncKey) {
    syncKey = nextSyncKey;
    selectedReasonCodes = Array.isArray(initialReasonCodes) ? [...initialReasonCodes] : [];
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
  <button
    type="button"
    class="reaction-dialog-overlay"
    aria-label="Close reaction reason dialog"
    on:click={close}
  ></button>

  <dialog
    class="reaction-dialog"
    open
    aria-modal="true"
    aria-label={dialogTitle(value)}
  >
    <div class="reaction-dialog-header">
      <div>
        <h3>{dialogTitle(value)}</h3>
        <p>Choose any that apply.</p>
      </div>
      <button
        type="button"
        class="reaction-dialog-close"
        aria-label="Close reaction reason dialog"
        on:click={close}
      >
        <IconX size={16} stroke={2} />
      </button>
    </div>

    <div class="reaction-chip-grid">
      {#each reasonOptions as option}
        <button
          type="button"
          class="reaction-chip"
          class:selected={selectedReasonCodes.includes(option.code)}
          aria-pressed={selectedReasonCodes.includes(option.code)}
          on:click={() => toggleReasonCode(option.code)}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <div class="reaction-dialog-actions">
      <Button variant="ghost" size="inline" on:click={skip}>Skip</Button>
      <Button size="inline" on:click={save}>Save reaction</Button>
    </div>
  </dialog>
{/if}

<style>
  .reaction-dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 180;
    border: none;
    background: rgba(7, 10, 17, 0.56);
    backdrop-filter: blur(4px);
    cursor: pointer;
  }

  .reaction-dialog {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 181;
    width: min(32rem, calc(100vw - 2rem));
    margin: 0;
    padding: 0;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    background: var(--surface-strong);
    box-shadow: var(--shadow-lg);
    color: var(--text-color);
  }

  .reaction-dialog-header {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  .reaction-dialog-header h3 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .reaction-dialog-header p {
    margin: 0.35rem 0 0;
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .reaction-dialog-close {
    background: var(--surface-soft);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--muted-text);
    flex-shrink: 0;
  }

  .reaction-chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-4);
  }

  .reaction-chip {
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
    color: var(--text-color);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.8rem;
    font: inherit;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .reaction-chip.selected {
    background: var(--primary-soft);
    border-color: color-mix(in srgb, var(--primary) 28%, var(--surface-border));
    color: var(--primary);
  }

  .reaction-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-4);
  }

  @media (max-width: 680px) {
    .reaction-dialog {
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      width: auto;
      transform: none;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      border-bottom: none;
    }
  }
</style>
