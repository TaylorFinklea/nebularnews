<script lang="ts">
  import { IconSparkles, IconStars, IconChevronDown } from '$lib/icons';
  import Pill from '$lib/components/Pill.svelte';

  export let summaryText: string | null = null;
  export let keyPoints: string[] = [];
  export let score: number | null = null;
  export let scoreLabel: string | null = null;
  export let scoreReason: string | null = null;
  export let scoreEvidence: string[] = [];

  let evidenceOpen = false;
  const hasInsights = Boolean(summaryText?.trim() || keyPoints.length || score !== null);
</script>

<section class="quick-take-shell" aria-labelledby="article-quick-take-heading">
  <div class="quick-take-head">
    <div>
      <p class="eyebrow">Quick Take</p>
      <h2 id="article-quick-take-heading">The fastest way to understand this story</h2>
    </div>
    <span class="quick-take-icon" aria-hidden="true">
      <IconSparkles size={18} stroke={1.9} />
    </span>
  </div>

  {#if hasInsights}
    {#if summaryText?.trim()}
      <p class="summary-text">{summaryText}</p>
    {/if}

    {#if keyPoints.length}
      <ul class="point-list" aria-label="Key points">
        {#each keyPoints as point}
          <li>{point}</li>
        {/each}
      </ul>
    {/if}

    {#if score !== null}
      <div class="fit-brief">
        <div class="fit-copy">
          <span class="fit-kicker">Fit signal</span>
          <div class="fit-row">
            <span class="fit-score">
              <IconStars size={16} stroke={1.9} />
              <strong>{Math.round(score)}/5</strong>
            </span>
            {#if scoreLabel}
              <Pill>{scoreLabel}</Pill>
            {/if}
          </div>
          {#if scoreReason}
            <p class="fit-reason">{scoreReason}</p>
          {/if}
        </div>

        {#if scoreEvidence.length}
          <div class="fit-rationale">
            <button
              type="button"
              class="evidence-trigger"
              aria-expanded={evidenceOpen}
              aria-controls="quick-take-evidence"
              on:click={() => (evidenceOpen = !evidenceOpen)}
            >
              <span>Why this fits</span>
              <span class="trigger-chevron" class:open={evidenceOpen}>
                <IconChevronDown size={15} stroke={2} />
              </span>
            </button>
            {#if evidenceOpen}
              <ul id="quick-take-evidence" class="evidence-list">
                {#each scoreEvidence as evidence}
                  <li>{evidence}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <p class="pending-copy">AI insights are still being prepared.</p>
  {/if}
</section>

<style>
  .quick-take-shell {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
    padding: clamp(1rem, 2vw, 1.4rem);
    border-radius: calc(var(--radius-xl) + 0.15rem);
    border: 1px solid color-mix(in srgb, var(--surface-border) 115%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-soft) 90%, transparent), color-mix(in srgb, var(--surface) 86%, transparent)),
      radial-gradient(circle at top right, color-mix(in srgb, var(--primary-soft) 85%, transparent), transparent 48%);
    box-shadow: 0 16px 36px color-mix(in srgb, var(--shadow-color) 38%, transparent);
  }

  .quick-take-head {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .eyebrow {
    margin: 0 0 0.35rem;
    color: var(--muted-text);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: clamp(1.1rem, 1.5vw, 1.35rem);
    line-height: 1.15;
    text-wrap: balance;
  }

  .quick-take-icon {
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    background: color-mix(in srgb, var(--primary-soft) 95%, transparent);
    border: 1px solid color-mix(in srgb, var(--surface-border) 110%, transparent);
  }

  .summary-text,
  .fit-reason,
  .pending-copy {
    margin: 0;
    font-size: clamp(1rem, 1.25vw, 1.08rem);
    line-height: 1.68;
    color: var(--text-color);
    overflow-wrap: anywhere;
  }

  .point-list,
  .evidence-list {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.55rem;
  }

  .point-list li,
  .evidence-list li {
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .fit-brief {
    min-width: 0;
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid color-mix(in srgb, var(--surface-border) 105%, transparent);
  }

  .fit-copy {
    min-width: 0;
    display: grid;
    gap: 0.5rem;
  }

  .fit-kicker {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted-text);
  }

  .fit-row {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }

  .fit-score {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--primary);
  }

  .evidence-trigger {
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .trigger-chevron {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--surface-soft) 75%, transparent);
    color: var(--muted-text);
    transition: transform var(--transition-normal), color var(--transition-normal);
  }

  .trigger-chevron.open {
    transform: rotate(180deg);
    color: var(--primary);
  }
</style>
