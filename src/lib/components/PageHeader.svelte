<script>
  export let title;
  export let description = '';
</script>

<section class="page-header">
  <div class="page-header-content">
    <slot name="pre" />
    <h1>{title}</h1>
    {#if description}
      <p class="description">{description}</p>
    {/if}
    <slot name="subnav" />
  </div>
  {#if $$slots.actions}
    <div class="page-header-actions">
      <slot name="actions" />
    </div>
  {/if}
</section>

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }

  h1 {
    font-size: var(--text-3xl);
    font-weight: 600;
    margin: 0 0 var(--space-2);
    line-height: 1.2;
  }

  .description {
    color: var(--muted-text);
    margin: 0;
  }

  .page-header-actions {
    display: grid;
    gap: var(--space-2);
    justify-items: end;
  }

  @media (max-width: 800px) {
    .page-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .page-header-actions {
      width: 100%;
      justify-items: start;
    }
  }
</style>
