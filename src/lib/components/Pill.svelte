<script>
  /** @type {'default' | 'success' | 'warning' | 'info' | 'muted' | 'running' | 'cancelled'} */
  export let variant = 'default';
</script>

<span class={`pill pill-${variant}`}>
  <slot />
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .pill-default {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .pill-success {
    background: rgba(90, 200, 170, 0.10);
    color: #7aded0;
  }

  :global(:root[data-theme='light']) .pill-success {
    background: rgba(22, 163, 120, 0.10);
    color: #0f8a65;
  }

  .pill-warning {
    background: rgba(220, 90, 130, 0.10);
    color: #e8889e;
  }

  :global(:root[data-theme='light']) .pill-warning {
    background: rgba(200, 50, 90, 0.10);
    color: #b82850;
  }

  .pill-info {
    background: rgba(70, 150, 230, 0.10);
    color: #6ab0e8;
  }

  :global(:root[data-theme='light']) .pill-info {
    background: rgba(30, 120, 220, 0.10);
    color: #1a6fba;
  }

  .pill-muted {
    background: var(--surface-soft);
    color: var(--muted-text);
  }

  .pill-running {
    background: rgba(70, 150, 230, 0.10);
    color: #6ab0e8;
  }

  :global(:root[data-theme='light']) .pill-running {
    background: rgba(30, 120, 220, 0.10);
    color: #1a6fba;
  }

  .pill-cancelled {
    background: rgba(130, 142, 190, 0.12);
    color: var(--muted-text);
  }
</style>
