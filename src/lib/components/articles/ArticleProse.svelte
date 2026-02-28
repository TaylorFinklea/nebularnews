<script lang="ts">
  export let blocks: any[] = [];
</script>

<section class="article-prose-shell" aria-labelledby="article-prose-heading">
  <div class="prose-header">
    <p class="prose-kicker">Full Story</p>
    <h2 id="article-prose-heading">Read the article</h2>
  </div>

  {#if blocks.length === 0}
    <p class="prose-empty">Full text pending.</p>
  {:else}
    <div class="prose-body">
      {#each blocks as block}
        {#if block.type === 'list'}
          <ul class="prose-list">
            {#each block.items as item}
              <li>{item}</li>
            {/each}
          </ul>
        {:else if block.type === 'heading'}
          <h3 class="prose-heading">{block.text}</h3>
        {:else if block.type === 'paragraph_group'}
          {#each block.paragraphs as paragraph}
            <p class="prose-paragraph">{paragraph}</p>
          {/each}
        {:else}
          <p class="prose-paragraph">{block.text}</p>
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .article-prose-shell {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
  }

  .prose-header {
    display: grid;
    gap: 0.35rem;
  }

  .prose-kicker {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  h2 {
    margin: 0;
    font-size: clamp(1.25rem, 1.8vw, 1.65rem);
    line-height: 1.1;
  }

  .prose-body,
  .prose-empty {
    max-inline-size: 68ch;
  }

  .prose-body {
    min-width: 0;
    display: grid;
    gap: 1rem;
  }

  .prose-paragraph,
  .prose-list li,
  .prose-empty {
    margin: 0;
    font-size: clamp(1rem, 1.2vw, 1.08rem);
    line-height: 1.72;
    overflow-wrap: anywhere;
  }

  .prose-heading {
    margin: 1rem 0 0;
    font-size: clamp(1.08rem, 1.4vw, 1.28rem);
    line-height: 1.28;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }

  .prose-list {
    margin: 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.55rem;
  }

  .prose-empty {
    color: var(--muted-text);
  }

  @media (max-width: 959px) {
    .prose-body,
    .prose-empty {
      max-inline-size: 100%;
    }
  }
</style>
