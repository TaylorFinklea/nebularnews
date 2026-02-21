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
    gap: 0.3rem;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .pill-default {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .pill-success {
    background: rgba(114, 236, 200, 0.18);
    color: #91f0cd;
  }

  :global(:root[data-theme='light']) .pill-success {
    background: rgba(22, 163, 120, 0.14);
    color: #0f8a65;
  }

  .pill-warning {
    background: rgba(255, 110, 150, 0.2);
    color: #ff9dbc;
  }

  :global(:root[data-theme='light']) .pill-warning {
    background: rgba(200, 50, 90, 0.12);
    color: #c12f5d;
  }

  .pill-info {
    background: rgba(88, 174, 255, 0.2);
    color: #72c3ff;
  }

  :global(:root[data-theme='light']) .pill-info {
    background: rgba(30, 120, 220, 0.14);
    color: #1a6fba;
  }

  .pill-muted {
    background: var(--surface-soft);
    color: var(--muted-text);
  }

  .pill-running {
    background: rgba(88, 174, 255, 0.2);
    color: #72c3ff;
  }

  :global(:root[data-theme='light']) .pill-running {
    background: rgba(30, 120, 220, 0.14);
    color: #1a6fba;
  }

  .pill-cancelled {
    background: rgba(130, 142, 190, 0.2);
    color: var(--muted-text);
  }
</style>
