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
    font-family: inherit;
    font-size: var(--text-base);
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
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
    transform: scale(0.97);
  }

  /* Variants */
  .btn-primary {
    background: var(--button-bg);
    color: var(--button-text);
    font-weight: 500;
  }

  .btn-ghost {
    background: transparent;
    color: var(--ghost-color);
    border: 1px solid var(--ghost-border);
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
    background: rgba(255, 110, 150, 0.12);
  }

  /* Sizes */
  .btn-default {
    padding: 0.6rem 1rem;
  }

  .btn-icon {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
  }

  .btn-inline {
    padding: 0.5rem 0.9rem;
    width: fit-content;
  }
</style>
