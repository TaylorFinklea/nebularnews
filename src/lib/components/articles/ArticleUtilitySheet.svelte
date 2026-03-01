<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { IconX } from '$lib/icons';

  export let open = false;
  export let title = 'Utilities';
  export let description = 'Manage article tools and metadata.';
  export let onClose: (() => void) | undefined = undefined;

  let sheetEl: HTMLDivElement | null = null;
  let previousOverflow = '';

  const close = () => onClose?.();

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  $: if (open) {
    void tick().then(() => {
      const focusTarget = sheetEl?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
      focusTarget?.focus();
    });
  }

  $: {
    if (typeof document !== 'undefined') {
      if (open) {
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      } else if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = previousOverflow;
      }
    }
  }

  onDestroy(() => {
    if (typeof document !== 'undefined' && document.body.style.overflow === 'hidden') {
      document.body.style.overflow = previousOverflow;
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div class="utility-sheet-root" aria-hidden={open ? 'false' : 'true'}>
    <button class="utility-sheet-overlay" type="button" aria-label="Close utilities" on:click={close} transition:fade={{ duration: 120 }}></button>
    <div
      class="utility-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      bind:this={sheetEl}
      transition:fly={{ y: 28, duration: 180 }}
    >
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-header">
        <div class="sheet-copy">
          <p class="sheet-kicker">Utilities</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button class="sheet-close" type="button" on:click={close} aria-label="Close utilities">
          <IconX size={16} stroke={2} />
        </button>
      </div>
      <div class="sheet-content">
        <slot />
      </div>
    </div>
  </div>
{/if}

<style>
  .utility-sheet-root {
    position: fixed;
    inset: 0;
    z-index: 70;
  }

  .utility-sheet-overlay {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgba(5, 10, 24, 0.58);
    backdrop-filter: blur(10px);
    cursor: pointer;
  }

  .utility-sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: min(80vh, 52rem);
    display: grid;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4) calc(var(--mobile-nav-height) + var(--mobile-nav-offset) + env(safe-area-inset-bottom) + var(--space-4));
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    border: 1px solid color-mix(in srgb, var(--surface-border) 120%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 92%, transparent), color-mix(in srgb, var(--surface) 96%, transparent)),
      radial-gradient(circle at top, color-mix(in srgb, var(--primary-soft) 90%, transparent), transparent 55%);
    box-shadow: 0 -20px 50px rgba(2, 6, 24, 0.45);
  }

  .sheet-handle {
    width: 3rem;
    height: 0.3rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--muted-text) 65%, transparent);
    justify-self: center;
  }

  .sheet-header {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .sheet-copy {
    min-width: 0;
    display: grid;
    gap: 0.35rem;
  }

  .sheet-kicker {
    margin: 0;
    color: var(--muted-text);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .sheet-copy h2 {
    margin: 0;
    font-size: var(--text-xl);
  }

  .sheet-copy p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-text);
    overflow-wrap: anywhere;
  }

  .sheet-close {
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-soft) 86%, transparent);
    color: var(--text-color);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
  }

  .sheet-content {
    min-width: 0;
    overflow-y: auto;
    padding-right: var(--space-1);
  }

  @media (min-width: 960px) {
    .utility-sheet-root {
      display: none;
    }
  }
</style>
