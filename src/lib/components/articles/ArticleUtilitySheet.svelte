<script>
  import { createEventDispatcher } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { IconX } from '$lib/icons';

  export let open = false;

  const dispatch = createEventDispatcher();

  const handleKeydown = (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      dispatch('close');
    }
  };
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <button
    class="sheet-overlay"
    aria-label="Close utilities"
    on:click={() => dispatch('close')}
    transition:fade={{ duration: 150 }}
  ></button>
  <dialog
    class="utility-sheet"
    open
    aria-modal="true"
    aria-label="Article utilities"
    transition:fly={{ y: 200, duration: 250, easing: cubicOut }}
  >
    <div class="sheet-header">
      <div class="sheet-handle" aria-hidden="true"></div>
      <button
        type="button"
        class="sheet-close"
        on:click={() => dispatch('close')}
        aria-label="Close utilities"
      >
        <IconX size={16} stroke={2} />
      </button>
    </div>
    <div class="sheet-scroll">
      <slot />
    </div>
  </dialog>
{/if}

<style>
  .sheet-overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    border: none;
    background: rgba(0, 0, 0, 0.44);
    backdrop-filter: blur(4px);
    cursor: pointer;
  }

  .utility-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 121;
    border: 1px solid var(--surface-border);
    border-bottom: none;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface-strong);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-lg);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    padding: 0;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-4) 0;
    position: relative;
  }

  .sheet-handle {
    width: 32px;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--surface-border);
  }

  .sheet-close {
    position: absolute;
    right: var(--space-4);
    top: var(--space-3);
    background: var(--surface-soft);
    border: none;
    border-radius: var(--radius-full);
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--muted-text);
  }

  .sheet-scroll {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }
</style>
