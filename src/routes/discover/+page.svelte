<script>
  import { IconRss } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';

  export let data;
</script>

<PageHeader title="Discover" description="Browse topics and feeds." />

<div class="feeds-row">
  <a href="/feeds" class="feeds-link">
    <IconRss size={16} stroke={1.9} />
    <span>Feeds</span>
    <span class="arrow">→</span>
  </a>
</div>

{#if data.tags.length === 0}
  <p class="empty">No tags yet. Tags appear here once articles are tagged.</p>
{:else}
  <div class="chip-grid">
    {#each data.tags as tag}
      <a
        href="/articles?tags={tag.id}"
        class="chip"
        style={tag.color ? `--chip-color: ${tag.color}` : undefined}
      >
        <span class="chip-name">{tag.name}</span>
        {#if tag.article_count > 0}
          <span class="chip-count">{tag.article_count}</span>
        {/if}
      </a>
    {/each}
  </div>
{/if}

<style>
  .feeds-row {
    margin-bottom: var(--space-5);
  }

  .feeds-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
    color: var(--text-color);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .feeds-link:hover {
    background: var(--primary-soft);
    border-color: var(--surface-border-hover);
  }

  .arrow {
    color: var(--muted-text);
    margin-left: var(--space-1);
  }

  .empty {
    color: var(--muted-text);
    margin: var(--space-6) 0;
  }

  .chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid var(--chip-color, var(--surface-border));
    background: color-mix(in srgb, var(--chip-color, var(--primary)) 10%, transparent);
    color: var(--text-color);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .chip:hover {
    background: color-mix(in srgb, var(--chip-color, var(--primary)) 20%, transparent);
    border-color: var(--chip-color, var(--surface-border-hover));
  }

  .chip-count {
    font-size: var(--text-xs);
    color: var(--muted-text);
    font-weight: 400;
  }
</style>
