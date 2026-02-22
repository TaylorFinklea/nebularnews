<script>
  export let pagination;
  export let pageHref;
  export let ariaLabel = 'Article pages';
</script>

<nav class="pagination" aria-label={ariaLabel}>
  {#if pagination?.hasPrev}
    <a class="ghost page-link" href={pageHref((pagination?.page ?? 1) - 1)}>Prev</a>
  {:else}
    <span class="ghost page-link disabled" aria-disabled="true">Prev</span>
  {/if}
  <span class="page-current">Page {pagination?.page ?? 1} / {pagination?.totalPages ?? 1}</span>
  {#if pagination?.hasNext}
    <a class="ghost page-link" href={pageHref((pagination?.page ?? 1) + 1)}>Next</a>
  {:else}
    <span class="ghost page-link disabled" aria-disabled="true">Next</span>
  {/if}
</nav>

<style>
  .pagination {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .page-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 3rem;
    border: 1px solid var(--ghost-border);
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
    color: var(--ghost-color);
    text-decoration: none;
  }

  .page-link.disabled {
    opacity: 0.45;
    cursor: default;
  }

  .page-current {
    color: var(--muted-text);
    font-size: 0.85rem;
    min-width: 6.6rem;
    text-align: center;
  }

  .ghost {
    background: transparent;
  }
</style>
