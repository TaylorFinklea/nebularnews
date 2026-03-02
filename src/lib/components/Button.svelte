<script>
  /** @type {'primary' | 'ghost' | 'danger'} */
  export let variant = 'primary';
  /** @type {'default' | 'icon' | 'inline'} */
  export let size = 'default';
  export let disabled = false;
  /** @type {string | null} */
  export let title = null;
  /** @type {string | null} */
  export let type = 'button';
</script>

<button
  class={`btn btn-${variant} btn-${size}`}
  {disabled}
  {title}
  aria-label={title}
  {type}
  on:click
  {...$$restProps}
>
  <slot />
</button>

<style>
  .btn {
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: 500;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    letter-spacing: 0.01em;
    transition:
      background var(--transition-fast),
      transform var(--transition-fast),
      box-shadow var(--transition-fast),
      opacity var(--transition-fast);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .btn:not(:disabled):active {
    transform: scale(0.98);
  }

  /* Variants */
  .btn-primary {
    background: var(--button-bg);
    color: var(--button-text);
  }

  .btn-primary:not(:disabled):hover {
    box-shadow: 0 2px 12px rgba(124, 106, 239, 0.25);
  }

  .btn-ghost {
    background: transparent;
    color: var(--ghost-color);
    border: 1px solid var(--ghost-border);
    border-radius: var(--radius-md);
  }

  .btn-ghost:not(:disabled):hover {
    background: var(--primary-soft);
  }

  .btn-danger {
    background: transparent;
    color: var(--danger);
    border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  }

  .btn-danger:not(:disabled):hover {
    background: rgba(255, 110, 150, 0.10);
  }

  /* Sizes */
  .btn-default {
    padding: 0.55rem 1.1rem;
  }

  .btn-icon {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border-radius: var(--radius-md);
  }

  .btn-inline {
    padding: 0.45rem 0.85rem;
    width: fit-content;
  }
</style>
