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
    box-shadow: none;
    border: 1px solid var(--surface-border);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
    display: grid;
    gap: var(--space-4);
    align-content: start;
    transition: box-shadow var(--transition-normal);
  }

  .card:hover {
    box-shadow: var(--shadow-md);
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
