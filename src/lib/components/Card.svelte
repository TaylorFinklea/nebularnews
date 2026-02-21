<script>
  /** @type {'default' | 'strong' | 'soft'} */
  export let variant = 'strong';
  /** @type {string | undefined} */
  export let id = undefined;
</script>

<div class={`card card-${variant}`} {id} {...$$restProps}>
  <slot />
</div>

<style>
  .card {
    padding: var(--space-6);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-md);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: var(--space-4);
    align-content: start;
  }
  .card-strong {
    background: var(--surface-strong);
  }
  .card-default {
    background: var(--surface);
  }
  .card-soft {
    background: var(--surface-soft);
  }
</style>
