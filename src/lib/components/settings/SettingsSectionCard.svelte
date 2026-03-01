<script>
  import Card from '$lib/components/Card.svelte';
  import { IconChevronDown } from '$lib/icons';

  export let id;
  export let title;
  export let summary = '';
  export let description = '';
  export let open = false;
  export let dirty = false;
  export let onToggle = () => {};

  $: titleId = `${id}-title`;
  $: contentId = `${id}-content`;
  $: triggerLabel = `${open ? 'Collapse' : 'Expand'} ${title}`;
</script>

<Card {id} class="settings-section-card" variant="strong">
  <button
    type="button"
    class="section-trigger"
    aria-controls={contentId}
    aria-expanded={open}
    aria-label={triggerLabel}
    on:click={onToggle}
  >
    <div class="section-copy">
      <div class="section-title-row">
        <h2 id={titleId}>{title}</h2>
        {#if dirty}
          <span class="dirty-badge">Changed</span>
        {/if}
      </div>
      {#if summary}
        <p class="section-summary">{summary}</p>
      {/if}
      {#if description}
        <p class="section-description">{description}</p>
      {/if}
    </div>
    <span class="section-icon" class:open>
      <IconChevronDown size={18} stroke={1.9} />
    </span>
  </button>

  {#if open}
    <div class="section-body" id={contentId} role="region" aria-labelledby={titleId}>
      <slot />
    </div>
  {/if}
</Card>

<style>
  :global(.settings-section-card) {
    scroll-margin-top: var(--space-6);
    gap: var(--space-4);
  }

  .section-trigger {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .section-copy {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  h2 {
    margin: 0;
    font-size: var(--text-xl);
  }

  .dirty-badge {
    border-radius: var(--radius-full);
    padding: 0.18rem 0.6rem;
    background: var(--primary-soft);
    color: var(--primary);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .section-summary,
  .section-description {
    margin: 0;
    color: var(--muted-text);
  }

  .section-summary {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .section-description {
    font-size: var(--text-sm);
  }

  .section-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    color: var(--muted-text);
    flex-shrink: 0;
    transition:
      transform var(--transition-fast),
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .section-trigger:hover .section-icon {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .section-icon.open {
    transform: rotate(180deg);
  }

  .section-body {
    display: grid;
    gap: var(--space-4);
  }
</style>
