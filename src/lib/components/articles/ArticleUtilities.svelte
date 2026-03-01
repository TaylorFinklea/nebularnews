<script>
  import { createEventDispatcher } from 'svelte';
  import {
    IconCheck,
    IconPlus,
    IconStars,
    IconTag,
    IconThumbDown,
    IconThumbUp,
    IconX
  } from '$lib/icons';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import ChatBox from '$lib/components/ChatBox.svelte';
  import ArticleUtilitySection from './ArticleUtilitySection.svelte';

  export let article;
  export let score = null;
  export let reaction = null;
  export let tags = [];
  export let tagSuggestions = [];
  export let availableTags = [];
  export let sources = [];
  export let chatReadiness = { canChat: false, reasons: [] };
  export let chatLog = [];
  export let message = '';
  export let sending = false;
  export let rerunBusy = false;
  export let tagBusy = false;
  export let tagError = '';
  export let tagInput = '';
  export let chatError = '';
  export let feedback = [];
  export let density = 'default';

  let rating = 3;
  let comment = '';

  const dispatch = createEventDispatcher();

  /** @type {Record<string, boolean>} */
  let openSections = { tags: true, ai_tools: true, chat: true, feedback: false, sources: false };

  const toggleSection = (e) => {
    const id = e.detail.id;
    openSections[id] = !openSections[id];
    openSections = openSections;
  };

  $: utilityHighlights = [
    tags.length > 0 && { label: 'Tags', count: tags.length },
    chatLog.length > 0 && { label: 'Chat', count: chatLog.length },
    feedback.length > 0 && { label: 'Feedback', count: feedback.length },
    sources.length > 0 && { label: 'Sources', count: sources.length }
  ].filter(Boolean);
</script>

<div class="utilities-panel" class:compact={density === 'compact'}>
  {#if utilityHighlights.length > 0}
    <div class="panel-highlights">
      {#each utilityHighlights as highlight}
        <span class="highlight-chip">{highlight.label}: {highlight.count}</span>
      {/each}
    </div>
  {/if}

  <!-- Feed vote -->
  <ArticleUtilitySection id="tags" title="Feed vote" summary="Tune source reputation" open={true} on:toggle={() => {}}>
    <p class="muted small">Tune source reputation without affecting AI score.</p>
    <div class="reaction-row">
      <button
        class="reaction-btn"
        class:active={reaction?.value === 1}
        on:click={() => dispatch('react', { value: 1 })}
        title="Thumbs up feed"
        aria-label="Thumbs up this feed"
      >
        <IconThumbUp size={16} stroke={1.9} />
      </button>
      <button
        class="reaction-btn"
        class:active={reaction?.value === -1}
        on:click={() => dispatch('react', { value: -1 })}
        title="Thumbs down feed"
        aria-label="Thumbs down this feed"
      >
        <IconThumbDown size={16} stroke={1.9} />
      </button>
    </div>
  </ArticleUtilitySection>

  <!-- Tags -->
  <ArticleUtilitySection id="tags" title="Tags" summary={tags.length ? `${tags.length} tags` : ''} open={openSections.tags} on:toggle={toggleSection}>
    <div class="section-header-row">
      <Button variant="ghost" size="icon" on:click={() => dispatch('rerun', { types: ['auto_tag'] })} disabled={rerunBusy || tagBusy} title="Run AI tagging">
        <IconTag size={15} stroke={1.9} />
      </Button>
    </div>
    {#if tags?.length}
      <div class="tag-row">
        {#each tags as tag}
          <button
            class="tag-chip"
            on:click={() => dispatch('removeTag', { tagId: tag.id })}
            disabled={tagBusy}
            title={`Remove ${tag.name}`}
          >
            <span>{tag.name}</span>
            {#if tag.source === 'ai'}<span class="tag-ai">AI</span>{/if}
            <IconX size={11} stroke={2} />
          </button>
        {/each}
      </div>
    {:else}
      <p class="muted small">No tags yet.</p>
    {/if}
    {#if tagSuggestions?.length}
      <div class="suggestion-row">
        {#each tagSuggestions as suggestion}
          <span class="suggestion-chip">
            <span>{suggestion.name}</span>
            <button
              type="button"
              class="suggestion-action"
              on:click={() => dispatch('acceptTagSuggestion', { suggestion })}
              title={`Accept suggested tag ${suggestion.name}`}
              aria-label={`Accept suggested tag ${suggestion.name}`}
              disabled={tagBusy}
            >
              <IconPlus size={11} stroke={2} />
            </button>
            <button
              type="button"
              class="suggestion-action"
              on:click={() => dispatch('dismissTagSuggestion', { suggestion })}
              title={`Dismiss suggested tag ${suggestion.name}`}
              aria-label={`Dismiss suggested tag ${suggestion.name}`}
              disabled={tagBusy}
            >
              <IconX size={11} stroke={2} />
            </button>
          </span>
        {/each}
      </div>
    {/if}
    <div class="input-row">
      <input
        list="article-tag-options"
        placeholder="Add tags (comma-separated)"
        bind:value={tagInput}
        disabled={tagBusy}
      />
      <Button variant="ghost" size="icon" on:click={() => dispatch('addTags', { names: tagInput.split(',').map(e => e.trim()).filter(Boolean) })} disabled={tagBusy} title="Add tags">
        <IconPlus size={15} stroke={1.9} />
      </Button>
    </div>
    {#if tagError}<p class="muted small err">{tagError}</p>{/if}
  </ArticleUtilitySection>

  <!-- AI Score -->
  <ArticleUtilitySection id="ai_tools" title="AI Fit Score" summary={score ? `${score.score}/5` : ''} open={openSections.ai_tools} on:toggle={toggleSection}>
    <div class="section-header-row">
      <Button variant="ghost" size="icon" on:click={() => dispatch('rerun', { types: ['score'] })} disabled={rerunBusy} title="Re-score article">
        <IconStars size={15} stroke={1.9} />
      </Button>
    </div>
    {#if score}
      <div class="score-display">
        <span class="score-num">{score.score}</span>
        <span class="score-denom">/ 5</span>
        <Pill>{score.label}</Pill>
      </div>
    {:else}
      <p class="muted small">Score pending.</p>
    {/if}
  </ArticleUtilitySection>

  <!-- Chat -->
  <ArticleUtilitySection id="chat" title="Chat with article" summary={chatLog.length ? `${chatLog.length} messages` : ''} open={openSections.chat} on:toggle={toggleSection}>
    <div class="section-header-row">
      <Pill variant={chatReadiness?.canChat ? 'success' : 'warning'}>
        {chatReadiness?.canChat ? 'Ready' : 'Needs setup'}
      </Pill>
    </div>
    <ChatBox
      {chatLog}
      bind:message
      {sending}
      disabled={!chatReadiness?.canChat}
      placeholder={chatReadiness?.canChat ? 'Ask about this article' : 'Complete chat setup first'}
      error={chatError}
      on:send
      density={density === 'compact' ? 'compact' : 'default'}
    />
  </ArticleUtilitySection>

  <!-- Feedback -->
  <ArticleUtilitySection id="feedback" title="Feedback" open={openSections.feedback} on:toggle={toggleSection}>
    <label class="form-label">
      Rating (1–5)
      <input type="number" min="1" max="5" bind:value={rating} />
    </label>
    <textarea rows="3" placeholder="What did the AI miss?" bind:value={comment}></textarea>
    <Button size="inline" on:click={() => dispatch('submitFeedback', { rating, comment })}>
      <IconCheck size={15} stroke={1.9} />
      <span>Save feedback</span>
    </Button>
  </ArticleUtilitySection>

  <!-- Sources -->
  {#if sources?.length}
    <ArticleUtilitySection id="sources" title="Source ranking" summary={`${sources.length} sources`} open={openSections.sources} on:toggle={toggleSection}>
      <ul class="source-list">
        {#each sources as source}
          <li>
            <strong>{source.sourceName}</strong>
            <span class="muted">rep {source.reputation.toFixed(2)} ({source.feedbackCount} votes)</span>
          </li>
        {/each}
      </ul>
    </ArticleUtilitySection>
  {/if}
</div>

<style>
  .utilities-panel {
    display: grid;
    gap: var(--space-3);
  }

  .panel-highlights {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--surface-border);
  }

  .highlight-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface-soft);
    border-radius: var(--radius-full);
    padding: 0.2rem 0.55rem;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--muted-text);
  }

  .section-header-row {
    display: flex;
    justify-content: flex-end;
  }

  .muted { color: var(--muted-text); margin: 0; }
  .small { font-size: var(--text-sm); }
  .err { color: var(--danger); }

  .reaction-row {
    display: flex;
    gap: var(--space-2);
  }

  .reaction-btn {
    background: var(--surface-soft);
    border: none;
    border-radius: var(--radius-full);
    width: 2.2rem;
    height: 2.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-color);
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .reaction-btn.active {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface-soft);
    border-radius: var(--radius-full);
    padding: 0.25rem 0.6rem;
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
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    padding: 0 0.3rem;
  }

  .suggestion-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    background: color-mix(in srgb, #4ade80 20%, transparent);
    border-radius: var(--radius-full);
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

  .input-row {
    display: flex;
    gap: var(--space-2);
  }

  input:not([type='number']),
  textarea {
    width: 100%;
    padding: 0.62rem 0.72rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
  }

  input[type='number'] {
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
    width: 100%;
  }

  .form-label {
    display: grid;
    gap: 0.35rem;
    font-size: var(--text-sm);
  }

  .score-display {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .score-num {
    font-size: 2rem;
    font-weight: 600;
    color: var(--primary);
    line-height: 1;
  }

  .score-denom {
    font-size: var(--text-base);
    color: var(--muted-text);
  }

  .source-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .source-list strong { display: block; }
</style>
