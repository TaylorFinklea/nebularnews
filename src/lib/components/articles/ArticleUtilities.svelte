<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import ChatBox from '$lib/components/ChatBox.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import ArticleUtilitySection from '$lib/components/articles/ArticleUtilitySection.svelte';
  import { IconCheck, IconFileText, IconListDetails, IconPlus, IconStars, IconTag, IconX } from '$lib/icons';
  import type { ArticleUtilityLayout, ArticleUtilitySectionId } from '$lib/client/articles/detail-types';

  export let layout: ArticleUtilityLayout = 'inspector';
  export let tags: any[] = [];
  export let tagSuggestions: any[] = [];
  export let tagBusy = false;
  export let tagError = '';
  export let tagInput = '';
  export let availableTags: any[] = [];
  export let rerunBusy = false;
  export let summary: any = null;
  export let keyPoints: any = null;
  export let score: any = null;
  export let chatReadiness: any = null;
  export let chatLog: any[] = [];
  export let message = '';
  export let sending = false;
  export let chatError = '';
  export let rating = 3;
  export let comment = '';
  export let feedbackCount = 0;
  export let sources: any[] = [];

  export let onAddTags: (() => void) | undefined = undefined;
  export let onRemoveTag: ((tagId: string) => void) | undefined = undefined;
  export let onAcceptTagSuggestion: ((suggestion: any) => void) | undefined = undefined;
  export let onDismissTagSuggestion: ((suggestion: any) => void) | undefined = undefined;
  export let onRerunJobs: ((types: string[]) => void) | undefined = undefined;
  export let onSendMessage: (() => void) | undefined = undefined;
  export let onSubmitFeedback: (() => void) | undefined = undefined;

  const defaultOpenSections: Record<ArticleUtilitySectionId, boolean> = {
    tags: false,
    ai_tools: false,
    chat: false,
    feedback: false,
    sources: false
  };

  let openSections = { ...defaultOpenSections };

  const toggleSection = (id: ArticleUtilitySectionId) => {
    openSections = { ...openSections, [id]: !openSections[id] };
  };

  const modelLabel = (entry: any) => {
    const provider = String(entry?.provider ?? '').trim();
    const model = String(entry?.model ?? '').trim();
    if (!provider && !model) return '';
    return provider && model ? `${provider}/${model}` : provider || model;
  };

  const summaryForTags = () => {
    const tagCount = tags.length;
    const suggestionCount = tagSuggestions.length;
    if (tagCount && suggestionCount) return `${tagCount} tags · ${suggestionCount} suggested`;
    if (tagCount) return `${tagCount} tags`;
    if (suggestionCount) return `${suggestionCount} suggested`;
    return 'None yet';
  };

  const summaryForChat = () => (chatReadiness?.canChat ? 'Ready' : 'Needs setup');
  const summaryForFeedback = () => (feedbackCount > 0 ? `${feedbackCount} saved` : 'Not yet rated');
  const summaryForSources = () => (sources.length > 0 ? `${sources.length} source${sources.length === 1 ? '' : 's'}` : 'No source data');
  const scoreDisplay = () => (Number.isFinite(Number(score?.score)) ? `${Math.round(Number(score?.score))}/5` : 'Pending');
</script>

<div class={`utility-panel utility-panel-${layout}`}>
  <div class="panel-header">
    <div>
      <p class="panel-kicker">Utilities</p>
      <h2>{layout === 'sheet' ? 'Article tools' : 'Article inspector'}</h2>
    </div>
    <p class="panel-summary">Secondary tools stay available without interrupting the reading flow.</p>
  </div>

  <ArticleUtilitySection
    id="tags"
    title="Tags"
    summary={summaryForTags()}
    open={openSections.tags}
    on:toggle={() => toggleSection('tags')}
  >
    <div class="utility-stack">
      {#if tags.length}
        <div class="chip-list">
          {#each tags as tag}
            <button
              type="button"
              class="tag-chip removable"
              on:click={() => onRemoveTag?.(String(tag.id ?? ''))}
              disabled={tagBusy}
              title={`Remove ${String(tag.name ?? 'tag')}`}
            >
              <span>{String(tag.name ?? 'Untitled')}</span>
              {#if tag.source === 'ai'}
                <span class="chip-badge">AI</span>
              {/if}
              <IconX size={12} stroke={2} />
            </button>
          {/each}
        </div>
      {:else}
        <p class="utility-note">No tags yet.</p>
      {/if}

      {#if tagSuggestions.length}
        <div class="chip-list suggestions">
          {#each tagSuggestions as suggestion}
            <span class="tag-chip suggestion-chip">
              <span>{String(suggestion.name ?? 'Suggestion')}</span>
              <button
                type="button"
                class="chip-action"
                on:click={() => onAcceptTagSuggestion?.(suggestion)}
                aria-label={`Accept ${String(suggestion.name ?? 'suggestion')}`}
                disabled={tagBusy}
              >
                <IconPlus size={12} stroke={2} />
              </button>
              <button
                type="button"
                class="chip-action"
                on:click={() => onDismissTagSuggestion?.(suggestion)}
                aria-label={`Dismiss ${String(suggestion.name ?? 'suggestion')}`}
                disabled={tagBusy}
              >
                <IconX size={12} stroke={2} />
              </button>
            </span>
          {/each}
        </div>
      {/if}

      <div class="input-row">
        <input
          list={`article-tag-options-${layout}`}
          placeholder="Add tags (comma-separated)"
          bind:value={tagInput}
          disabled={tagBusy}
        />
        <Button variant="ghost" size="icon" on:click={() => onAddTags?.()} disabled={tagBusy} title="Add tags">
          <IconPlus size={15} stroke={1.9} />
        </Button>
      </div>

      {#if tagError}
        <p class="utility-error">{tagError}</p>
      {/if}
    </div>
  </ArticleUtilitySection>

  <ArticleUtilitySection
    id="ai_tools"
    title="AI Tools"
    summary={`Fit score · ${scoreDisplay()}`}
    open={openSections.ai_tools}
    on:toggle={() => toggleSection('ai_tools')}
  >
    <div class="utility-stack">
      <p class="utility-note">Refresh AI-generated metadata without leaving the article.</p>
      <div class="tool-grid">
        <button type="button" class="tool-button" on:click={() => onRerunJobs?.(['summarize'])} disabled={rerunBusy}>
          <IconFileText size={15} stroke={1.9} />
          <span>Rebuild summary</span>
        </button>
        <button type="button" class="tool-button" on:click={() => onRerunJobs?.(['key_points'])} disabled={rerunBusy}>
          <IconListDetails size={15} stroke={1.9} />
          <span>Rebuild key points</span>
        </button>
        <button type="button" class="tool-button" on:click={() => onRerunJobs?.(['score'])} disabled={rerunBusy}>
          <IconStars size={15} stroke={1.9} />
          <span>Re-score fit</span>
        </button>
        <button type="button" class="tool-button" on:click={() => onRerunJobs?.(['auto_tag'])} disabled={rerunBusy || tagBusy}>
          <IconTag size={15} stroke={1.9} />
          <span>Refresh tags</span>
        </button>
      </div>

      <div class="meta-list">
        {#if modelLabel(summary)}
          <div class="meta-item"><span>Summary</span><strong>{modelLabel(summary)}</strong></div>
        {/if}
        {#if modelLabel(keyPoints)}
          <div class="meta-item"><span>Key points</span><strong>{modelLabel(keyPoints)}</strong></div>
        {/if}
        <div class="meta-item"><span>Fit score</span><strong>{scoreDisplay()}</strong></div>
      </div>
    </div>
  </ArticleUtilitySection>

  <ArticleUtilitySection
    id="chat"
    title="Chat"
    summary={summaryForChat()}
    open={openSections.chat}
    on:toggle={() => toggleSection('chat')}
  >
    <div class="utility-stack">
      <div class="chat-head">
        <p class="utility-note">Ask follow-up questions without leaving the article.</p>
        <Pill variant={chatReadiness?.canChat ? 'success' : 'warning'}>{summaryForChat()}</Pill>
      </div>
      {#if !chatReadiness?.canChat && Array.isArray(chatReadiness?.reasons) && chatReadiness.reasons.length > 0}
        <ul class="reason-list">
          {#each chatReadiness.reasons as reason}
            <li>{reason}</li>
          {/each}
        </ul>
      {/if}
      <ChatBox
        density="compact"
        {chatLog}
        bind:message
        {sending}
        disabled={!chatReadiness?.canChat}
        placeholder={chatReadiness?.canChat ? 'Ask about this article' : 'Complete chat setup first'}
        error={chatError}
        on:send={() => onSendMessage?.()}
      />
    </div>
  </ArticleUtilitySection>

  <ArticleUtilitySection
    id="feedback"
    title="Feedback"
    summary={summaryForFeedback()}
    open={openSections.feedback}
    on:toggle={() => toggleSection('feedback')}
  >
    <div class="utility-stack">
      <p class="utility-note">Capture what the AI missed so future scoring and summaries improve.</p>
      <label class="field-label">
        <span>Rating (1–5)</span>
        <input type="number" min="1" max="5" bind:value={rating} />
      </label>
      <textarea rows="4" placeholder="What did the AI miss?" bind:value={comment}></textarea>
      <Button size="inline" on:click={() => onSubmitFeedback?.()}>
        <IconCheck size={15} stroke={1.9} />
        <span>Save feedback</span>
      </Button>
    </div>
  </ArticleUtilitySection>

  <ArticleUtilitySection
    id="sources"
    title="Sources"
    summary={summaryForSources()}
    open={openSections.sources}
    on:toggle={() => toggleSection('sources')}
  >
    {#if sources.length}
      <ul class="source-list">
        {#each sources as source}
          <li>
            <strong>{String(source.sourceName ?? 'Unknown source')}</strong>
            <span>rep {Number(source.reputation ?? 0).toFixed(2)} ({Number(source.feedbackCount ?? 0)} votes)</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="utility-note">No source ranking available yet.</p>
    {/if}
  </ArticleUtilitySection>

  <datalist id={`article-tag-options-${layout}`}>
    {#each availableTags as tag}
      <option value={String(tag.name ?? '')}></option>
    {/each}
  </datalist>
</div>

<style>
  .utility-panel {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
    padding: clamp(0.95rem, 1.4vw, 1.2rem);
    border-radius: calc(var(--radius-xl) + 0.1rem);
    border: 1px solid color-mix(in srgb, var(--surface-border) 115%, transparent);
    background: linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 88%, transparent), color-mix(in srgb, var(--surface) 88%, transparent));
    box-shadow: 0 18px 40px color-mix(in srgb, var(--shadow-color) 35%, transparent);
    overflow: clip;
  }

  .utility-panel-inspector {
    position: sticky;
    top: calc(var(--space-8) + 0.25rem);
  }

  .panel-header {
    min-width: 0;
    display: grid;
    gap: 0.35rem;
  }

  .panel-kicker {
    margin: 0;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted-text);
  }

  .panel-header h2,
  .panel-header p {
    margin: 0;
  }

  .panel-header h2 {
    font-size: var(--text-lg);
  }

  .panel-summary {
    font-size: var(--text-sm);
    color: var(--muted-text);
    overflow-wrap: anywhere;
  }

  .utility-stack,
  .chat-head {
    min-width: 0;
    display: grid;
    gap: var(--space-3);
  }

  .utility-note,
  .reason-list li,
  .source-list span,
  .meta-item span,
  .meta-item strong {
    overflow-wrap: anywhere;
  }

  .utility-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-text);
    line-height: 1.55;
  }

  .chip-list {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tag-chip {
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.32rem 0.62rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-soft) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--surface-border) 110%, transparent);
    color: var(--text-color);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .tag-chip.removable,
  .chip-action,
  .tool-button {
    cursor: pointer;
  }

  .chip-badge {
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    color: var(--muted-text);
  }

  .suggestion-chip {
    background: color-mix(in srgb, #4ade80 18%, transparent);
  }

  .chip-action {
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chip-action:disabled,
  .tag-chip.removable:disabled,
  .tool-button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .input-row {
    min-width: 0;
    display: flex;
    gap: var(--space-2);
  }

  .input-row :global(input),
  textarea {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 0.72rem 0.8rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font: inherit;
  }

  .field-label {
    min-width: 0;
    display: grid;
    gap: 0.4rem;
    font-size: var(--text-sm);
  }

  .field-label span {
    color: var(--muted-text);
  }

  .utility-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .tool-grid {
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
  }

  .tool-button {
    min-width: 0;
    min-height: 44px;
    padding: 0.75rem 0.8rem;
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in srgb, var(--surface-border) 115%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 86%, transparent);
    color: var(--text-color);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: flex-start;
    font: inherit;
    overflow-wrap: anywhere;
  }

  .meta-list {
    min-width: 0;
    display: grid;
    gap: 0.55rem;
  }

  .meta-item {
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .meta-item span {
    color: var(--muted-text);
  }

  .meta-item strong {
    text-align: right;
    font-weight: 600;
  }

  .reason-list,
  .source-list {
    margin: 0;
    padding-left: 1rem;
    display: grid;
    gap: 0.55rem;
  }

  .source-list strong {
    display: block;
    margin-bottom: 0.15rem;
  }

  @media (max-width: 959px) {
    .utility-panel-inspector {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .input-row {
      flex-wrap: wrap;
    }

    .tool-grid {
      grid-template-columns: 1fr;
    }

    .meta-item {
      grid-template-columns: 1fr;
      display: grid;
    }
  }
</style>
