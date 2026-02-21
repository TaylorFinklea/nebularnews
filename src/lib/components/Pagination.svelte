<script>
  /** @type {{ page: number; totalPages: number; hasPrev: boolean; hasNext: boolean; start: number; end: number; total: number }} */
  export let pagination;
  /** @type {(page: number) => string} */
  export let hrefBuilder;
  /** @type {boolean} */
  export let showMeta = true;
</script>

{#if showMeta}
  <div class="pagination-meta">
    <span class="count">
      Showing {pagination.start}-{pagination.end} of {pagination.total}
    </span>
    {#if pagination.totalPages > 1}
      <nav class="pagination" aria-label="Pages">
        {#if pagination.hasPrev}
          <a class="page-link" href={hrefBuilder(pagination.page - 1)} data-sveltekit-reload="true">Prev</a>
        {:else}
          <span class="page-link disabled" aria-disabled="true">Prev</span>
        {/if}
        <span class="page-current">Page {pagination.page} / {pagination.totalPages}</span>
        {#if pagination.hasNext}
          <a class="page-link" href={hrefBuilder(pagination.page + 1)} data-sveltekit-reload="true">Next</a>
        {:else}
          <span class="page-link disabled" aria-disabled="true">Next</span>
        {/if}
      </nav>
    {/if}
  </div>
{:else if pagination.totalPages > 1}
  <div class="pagination-center">
    <nav class="pagination" aria-label="Pages">
      {#if pagination.hasPrev}
        <a class="page-link" href={hrefBuilder(pagination.page - 1)} data-sveltekit-reload="true">Prev</a>
      {:else}
        <span class="page-link disabled" aria-disabled="true">Prev</span>
      {/if}
      <span class="page-current">Page {pagination.page} / {pagination.totalPages}</span>
      {#if pagination.hasNext}
        <a class="page-link" href={hrefBuilder(pagination.page + 1)} data-sveltekit-reload="true">Next</a>
      {:else}
        <span class="page-link disabled" aria-disabled="true">Next</span>
      {/if}
    </nav>
  </div>
{/if}

<style>
  .pagination-meta {
    margin-bottom: var(--space-4);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--muted-text);
    font-size: var(--text-sm);
    flex-wrap: wrap;
  }

  .pagination-center {
    margin-top: var(--space-4);
    display: flex;
    justify-content: center;
  }

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
    border-radius: var(--radius-full);
    padding: 0.25rem 0.7rem;
    color: var(--ghost-color);
    text-decoration: none;
    font-size: var(--text-sm);
    transition: background var(--transition-fast);
  }

  .page-link:not(.disabled):hover {
    background: var(--primary-soft);
  }

  .page-link.disabled {
    opacity: 0.45;
    cursor: default;
  }

  .page-current {
    color: var(--muted-text);
    font-size: var(--text-sm);
    min-width: 6.6rem;
    text-align: center;
  }
</style>
