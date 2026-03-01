<script>
  /** @type {import('$lib/client/articles/detail-types').ArticleBlock[]} */
  export let blocks = [];
</script>

<div class="article-text">
  {#if blocks.length === 0}
    <p class="muted">Full text pending.</p>
  {:else}
    {#each blocks as block}
      {#if block.type === 'list'}
        <ul class="article-list">
          {#each block.items as item}<li>{item}</li>{/each}
        </ul>
      {:else if block.type === 'heading'}
        <h3 class="article-heading">{block.text}</h3>
      {:else if block.type === 'paragraph_group'}
        {#each block.paragraphs as paragraph}
          <p class="article-paragraph">{paragraph}</p>
        {/each}
      {:else}
        <p class="article-paragraph">{block.text}</p>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .article-text {
    display: grid;
    gap: 0.85rem;
    line-height: 1.75;
    color: var(--text-color);
  }

  .article-paragraph { margin: 0; }

  .article-list {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.35rem;
  }

  .article-heading {
    margin: 0.25rem 0 0;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .muted { color: var(--muted-text); margin: 0; }
</style>
