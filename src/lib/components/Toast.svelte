<script>
  import { fly } from 'svelte/transition';
  import { toasts, dismissToast, runToastAction } from '$lib/client/toast';
  import { IconX } from '$lib/icons';
</script>

{#if $toasts.length > 0}
  <div class="toast-stack" aria-live="polite">
    {#each $toasts as toast (toast.id)}
      <div
        class={`toast toast-${toast.variant}`}
        in:fly={{ y: 20, duration: 200 }}
        out:fly={{ y: 20, duration: 150 }}
      >
        <span class="toast-message">{toast.message}</span>
        {#if toast.action}
          <button
            class="toast-action"
            on:click={() => runToastAction(toast.id)}
            aria-label={toast.action.label}
          >
            {toast.action.label}
          </button>
        {/if}
        <button
          class="toast-dismiss"
          on:click={() => dismissToast(toast.id)}
          aria-label="Dismiss notification"
        >
          <IconX size={14} stroke={2} />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    display: grid;
    gap: var(--space-2);
    z-index: 200;
    max-width: 420px;
    width: 100%;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    padding: 0.7rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    box-shadow: var(--shadow-md);
  }

  .toast-info {
    background: var(--surface-strong);
    color: var(--text-color);
  }

  .toast-success {
    background: var(--surface-strong);
    color: #91f0cd;
    border-color: rgba(114, 236, 200, 0.3);
  }

  :global(:root[data-theme='light']) .toast-success {
    color: #0f8a65;
    border-color: rgba(22, 163, 120, 0.3);
  }

  .toast-error {
    background: var(--surface-strong);
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  }

  .toast-message {
    flex: 1;
  }

  .toast-dismiss {
    background: none;
    border: none;
    color: var(--muted-text);
    cursor: pointer;
    padding: 0.2rem;
    display: flex;
    flex-shrink: 0;
  }

  .toast-action {
    background: transparent;
    border: 1px solid var(--surface-border);
    color: var(--text-color);
    border-radius: var(--radius-full);
    padding: 0.2rem 0.55rem;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  @media (max-width: 500px) {
    .toast-stack {
      left: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
    }
  }
</style>
