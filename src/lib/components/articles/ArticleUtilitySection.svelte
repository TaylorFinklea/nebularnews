<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { slide } from 'svelte/transition';
  import { IconChevronDown } from '$lib/icons';
  import type { ArticleUtilitySectionId } from '$lib/client/articles/detail-types';

  export let id: ArticleUtilitySectionId;
  export let title = '';
  export let summary = '';
  export let open = false;

  const dispatch = createEventDispatcher<{ toggle: { id: ArticleUtilitySectionId } }>();
  $: panelId = `article-utility-panel-${id}`;
</script>

<section class="utility-section" class:open>
  <button
    type="button"
    class="utility-trigger"
    aria-expanded={open}
    aria-controls={panelId}
    on:click={() => dispatch('toggle', { id })}
  >
    <span class="trigger-copy">
      <span class="trigger-title">{title}</span>
      {#if summary}
        <span class="trigger-summary">{summary}</span>
      {/if}
    </span>
    <span class="trigger-chevron" class:open>
      <IconChevronDown size={16} stroke={2} />
    </span>
  </button>

  {#if open}
    <div id={panelId} class="utility-body" transition:slide={{ duration: 140 }}>
      <slot />
    </div>
  {/if}
</section>

<style>
  .utility-section {
    min-width: 0;
    border-top: 1px solid var(--surface-border);
    padding-top: var(--space-3);
  }

  .utility-section:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .utility-trigger {
    width: 100%;
    min-width: 0;
    padding: 0.35rem 0.45rem;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    text-align: left;
  }

  .trigger-copy {
    min-width: 0;
    display: grid;
    gap: 0.2rem;
  }

  .trigger-title {
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .trigger-summary {
    font-size: var(--text-xs);
    color: var(--muted-text);
    overflow-wrap: anywhere;
  }

  .trigger-chevron {
    width: 1.9rem;
    height: 1.9rem;
    border-radius: var(--radius-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--muted-text);
    background: var(--surface-soft);
    transition: transform var(--transition-normal), color var(--transition-normal), background var(--transition-normal);
  }

  .trigger-chevron.open {
    transform: rotate(180deg);
    color: var(--primary);
    background: var(--primary-soft);
  }

  .utility-body {
    min-width: 0;
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) 0.45rem 0;
  }

  .utility-section.open .utility-trigger {
    background: var(--surface-soft);
  }
</style>
