<script>
  import { createEventDispatcher } from 'svelte';
  import { slide } from 'svelte/transition';
  import { IconChevronDown, IconFileText, IconListDetails, IconSparkles } from '$lib/icons';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';

  export let summary = null;
  export let keyPoints = null;
  export let rerunBusy = false;

  let open = true;
  const dispatch = createEventDispatcher();
</script>

<Card>
  <button type="button" class="quick-take-trigger" on:click={() => (open = !open)}>
    <span class="trigger-icon">
      <IconSparkles size={16} stroke={1.9} />
    </span>
    <h2>Quick Take</h2>
    <span class="chevron" class:rotated={open}>
      <IconChevronDown size={14} stroke={1.9} />
    </span>
  </button>

  {#if open}
    <div class="quick-take-body" transition:slide={{ duration: 140 }}>
      <div class="card-title-row">
        <h3>Summary</h3>
        <Button variant="ghost" size="icon" on:click={() => dispatch('rerun', { types: ['summarize'] })} disabled={rerunBusy} title="Rebuild summary">
          <IconFileText size={15} stroke={1.9} />
        </Button>
      </div>
      <p class="summary-text">{summary?.summary_text ?? 'Summary pending.'}</p>
      {#if summary?.provider && summary?.model}
        <p class="muted">Model: {summary.provider}/{summary.model}</p>
      {/if}

      {#if keyPoints?.points?.length}
        <div class="card-title-row">
          <h3>Key Points</h3>
          <Button variant="ghost" size="icon" on:click={() => dispatch('rerun', { types: ['key_points'] })} disabled={rerunBusy} title="Rebuild key points">
            <IconListDetails size={15} stroke={1.9} />
          </Button>
        </div>
        <ul class="key-list">
          {#each keyPoints.points as point}
            <li>{point}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</Card>

<style>
  .quick-take-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .trigger-icon {
    display: flex;
    align-items: center;
    color: var(--primary);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    flex: 1;
  }

  h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  .chevron {
    display: flex;
    color: var(--muted-text);
    transition: transform 0.15s ease;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .quick-take-body {
    display: grid;
    gap: var(--space-4);
    padding-top: var(--space-3);
  }

  .card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .summary-text { margin: 0; }

  .muted {
    color: var(--muted-text);
    margin: 0;
    font-size: var(--text-sm);
  }

  .key-list {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.4rem;
    font-size: var(--text-sm);
    line-height: 1.55;
  }
</style>
