<script>
  import { createEventDispatcher } from 'svelte';
  import { getReactionReasonLabel } from '$lib/article-reactions';
  import { getFitScoreTone } from '$lib/fit-score';
  import {
    IconCheck,
    IconExternalLink,
    IconEye,
    IconEyeOff,
    IconPlus,
    IconStars,
    IconTag,
    IconThumbDown,
    IconThumbUp,
    IconX
  } from '$lib/icons';
  import ReactionReasonDialog from './ReactionReasonDialog.svelte';

  export let article;
  export let score = null;
  export let reaction = null;
  export let tags = [];
  export let tagSuggestions = [];
  export let availableTags = [];
  export let sources = [];
  export let rerunBusy = false;
  export let tagBusy = false;
  export let tagError = '';
  export let tagInput = '';
  export let feedback = [];
  export let isRead = false;
  export let readStateBusy = false;

  let rating = 3;
  let comment = '';
  let reactionDialogOpen = false;
  let pendingReactionValue = 1;
  let pendingReactionReasonCodes = [];
  let scoreDetailsOpen = false;

  const dispatch = createEventDispatcher();

  const openReactionDialog = (value) => {
    pendingReactionValue = value;
    pendingReactionReasonCodes =
      reaction?.value === value && Array.isArray(reaction?.reason_codes) ? [...reaction.reason_codes] : [];
    reactionDialogOpen = true;
  };

  const closeReactionDialog = () => {
    reactionDialogOpen = false;
  };

  const saveReaction = (reasonCodes) => {
    dispatch('react', { value: pendingReactionValue, reasonCodes });
    closeReactionDialog();
  };

  $: savedReactionReasonLabels = Array.isArray(reaction?.reason_codes)
    ? reaction.reason_codes.map((reasonCode) => getReactionReasonLabel(reasonCode))
    : [];
</script>

<div class="article-utilities">
  <!-- Action bar -->
  <div class="action-bar">
    {#if article.canonical_url}
      <a class="action-btn primary" href={article.canonical_url} target="_blank" rel="noopener noreferrer">
        <IconExternalLink size={14} /> Open article
      </a>
    {/if}
    <button class="action-btn" on:click={() => dispatch('toggleRead')} disabled={readStateBusy}>
      {#if isRead}<IconEyeOff size={14} />{:else}<IconEye size={14} />{/if}
      {isRead ? 'Read' : 'Unread'}
    </button>
    <button class="action-btn" class:active={reaction?.value === 1} on:click={() => openReactionDialog(1)}>
      <IconThumbUp size={14} />
    </button>
    <button class="action-btn" class:active={reaction?.value === -1} on:click={() => openReactionDialog(-1)}>
      <IconThumbDown size={14} />
    </button>
    {#if score && score.score}
      <button class="score-pill {getFitScoreTone(score.score, score.status)}" on:click={() => scoreDetailsOpen = !scoreDetailsOpen}>
        <IconStars size={13} /> {score.score}/5
      </button>
    {/if}
  </div>

  <!-- Saved reaction reasons -->
  {#if savedReactionReasonLabels.length > 0}
    <div class="reason-pills">
      {#each savedReactionReasonLabels as label}
        <span class="reason-pill">{label}</span>
      {/each}
    </div>
  {/if}

  <!-- Tags section (always visible) -->
  <div class="tags-section">
    {#if tags?.length}
      {#each tags as tag}
        <button class="tag-chip" on:click={() => dispatch('removeTag', { tagId: tag.id })} disabled={tagBusy} title={`Remove ${tag.name}`}>
          {tag.name} {#if tag.source === 'ai'}<span class="tag-ai">AI</span>{/if}
          <IconX size={10} />
        </button>
      {/each}
    {/if}
    {#if tagSuggestions?.length}
      {#each tagSuggestions as suggestion}
        <span class="suggestion-chip">
          {suggestion.name}
          <button class="suggestion-action" on:click={() => dispatch('acceptTagSuggestion', { suggestion })} disabled={tagBusy} title={`Accept suggested tag ${suggestion.name}`}>
            <IconPlus size={10} />
          </button>
          <button class="suggestion-action" on:click={() => dispatch('dismissTagSuggestion', { suggestion })} disabled={tagBusy} title={`Dismiss suggested tag ${suggestion.name}`}>
            <IconX size={10} />
          </button>
        </span>
      {/each}
    {/if}
    <div class="tag-add-inline">
      <input
        list="article-tag-options"
        placeholder="Add tag"
        bind:value={tagInput}
        disabled={tagBusy}
        on:keydown={(e) => { if (e.key === 'Enter') dispatch('addTags', { names: tagInput.split(',').map(t => t.trim()).filter(Boolean) }); }}
      />
    </div>
    <button class="action-btn-sm" on:click={() => dispatch('rerun', { types: ['auto_tag'] })} disabled={rerunBusy || tagBusy} title="AI tag">
      <IconTag size={12} />
    </button>
    {#if tagError}<span class="tag-error">{tagError}</span>{/if}
  </div>

  <!-- Score details (toggled from action bar pill) -->
  {#if scoreDetailsOpen && score}
    <div class="score-details">
      {#if score.label}<p class="score-method">{score.label}</p>{/if}
      {#if score.reason_text}<p class="score-reason">{score.reason_text}</p>{/if}
      {#if score.evidence?.length}
        <ul class="score-evidence">
          {#each score.evidence as evidence}<li>{evidence}</li>{/each}
        </ul>
      {/if}
      <button class="action-btn-sm" on:click={() => dispatch('rerun', { types: ['score'] })} disabled={rerunBusy}>
        <IconStars size={12} /> Re-score
      </button>
    </div>
  {/if}

  <!-- Sources -->
  {#if sources?.length}
    <details class="extras-section">
      <summary>Sources ({sources.length})</summary>
      <ul class="source-list">
        {#each sources as source}
          <li>{source.sourceName} <span class="muted">rep {source.reputation.toFixed(2)}</span></li>
        {/each}
      </ul>
    </details>
  {/if}

  <!-- Feedback -->
  <details class="extras-section">
    <summary>Feedback</summary>
    <div class="feedback-form">
      <div class="feedback-row">
        <label>Rating <input type="number" min="1" max="5" bind:value={rating} /></label>
        <textarea rows="2" placeholder="What did the AI miss?" bind:value={comment}></textarea>
        <button class="action-btn" on:click={() => dispatch('submitFeedback', { rating, comment })}>
          <IconCheck size={13} /> Save
        </button>
      </div>
    </div>
  </details>

  <ReactionReasonDialog
    open={reactionDialogOpen}
    value={pendingReactionValue}
    initialReasonCodes={pendingReactionReasonCodes}
    on:close={closeReactionDialog}
    on:skip={() => saveReaction([])}
    on:save={(e) => saveReaction(e.detail.reasonCodes ?? [])}
  />
</div>

<style>
  .article-utilities {
    display: grid;
    gap: var(--space-3);
  }

  /* ── Action bar ── */
  .action-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: var(--space-3) 0;
    border-top: 1px solid var(--surface-border);
    border-bottom: 1px solid var(--surface-border);
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-color);
    cursor: pointer;
    text-decoration: none;
    font-family: inherit;
  }

  .action-btn:hover { background: var(--primary-soft); }
  .action-btn.active { background: var(--primary-soft); color: var(--primary); border-color: var(--primary); }
  .action-btn.primary { background: var(--button-bg); color: var(--button-text); border-color: transparent; }
  .action-btn:disabled { opacity: 0.5; cursor: wait; }

  .score-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.65rem;
    border-radius: 999px;
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    margin-left: auto;
    font-family: inherit;
    color: var(--muted-text);
  }

  .score-pill.fit-1 { color: #fca5a5; border-color: rgba(252,165,165,0.4); }
  .score-pill.fit-2 { color: #fdba74; border-color: rgba(253,186,116,0.4); }
  .score-pill.fit-3 { color: #c4b5fd; border-color: rgba(196,181,253,0.4); }
  .score-pill.fit-4 { color: #67e8f9; border-color: rgba(103,232,249,0.4); }
  .score-pill.fit-5 { color: #86efac; border-color: rgba(134,239,172,0.4); }

  /* ── Reaction reasons ── */
  .reason-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .reason-pill {
    display: inline-flex;
    align-items: center;
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--muted-text);
  }

  /* ── Tags ── */
  .tags-section {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    padding: var(--space-2) 0;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    font-size: var(--text-sm);
    cursor: pointer;
    color: var(--text-color);
    border: none;
    font: inherit;
    transition: background var(--transition-fast);
  }

  .tag-chip:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 15%, transparent); }
  .tag-chip:disabled { opacity: 0.6; cursor: default; }

  .tag-ai {
    font-size: 0.68rem;
    color: var(--muted-text);
    border-radius: var(--radius-sm);
    background: var(--surface-soft);
    padding: 0 0.3rem;
  }

  .suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    background: color-mix(in srgb, #4ade80 14%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.35rem 0.2rem 0.6rem;
    font-size: var(--text-sm);
    color: var(--text-color);
  }

  .suggestion-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    padding: 0;
  }

  .suggestion-action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface-strong) 55%, transparent);
    border-color: var(--surface-border);
  }

  .suggestion-action:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .tag-add-inline input {
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    font-size: var(--text-sm);
    width: 100px;
    font-family: inherit;
    color: var(--text-color);
  }

  .tag-error {
    font-size: var(--text-sm);
    color: var(--danger);
  }

  /* ── Score details ── */
  .score-details {
    background: var(--primary-soft);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
    border: 1px solid var(--surface-border);
  }

  .score-method {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--primary);
    font-weight: 600;
  }

  .score-reason {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-color);
  }

  .score-evidence {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.25rem;
  }

  .score-evidence li {
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  /* ── Collapsible extras ── */
  .extras-section {
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .extras-section summary {
    padding: var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    color: var(--muted-text);
  }

  .extras-section summary:hover { color: var(--text-color); }

  .extras-section > :not(summary) {
    padding: 0 var(--space-3) var(--space-3);
  }

  .source-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .muted { color: var(--muted-text); }

  .feedback-row {
    display: grid;
    gap: var(--space-2);
  }

  .feedback-row label {
    display: grid;
    gap: 0.35rem;
    font-size: var(--text-sm);
  }

  .feedback-row input[type='number'] {
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
    width: 100%;
  }

  .feedback-row textarea {
    width: 100%;
    padding: 0.62rem 0.72rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  /* ── Small action button ── */
  .action-btn-sm {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    font-size: var(--text-xs);
    color: var(--muted-text);
    cursor: pointer;
    font-family: inherit;
  }

  .action-btn-sm:hover { background: var(--primary-soft); }
  .action-btn-sm:disabled { opacity: 0.5; cursor: wait; }
</style>
