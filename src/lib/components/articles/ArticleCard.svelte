<script>
  import { createEventDispatcher } from 'svelte';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import Pill from '$lib/components/Pill.svelte';
  import { IconEye, IconEyeOff, IconPlus, IconStars, IconThumbDown, IconThumbUp, IconX } from '$lib/icons';
  import { isArticleRead, reactionNumber } from '$lib/client/articles/articles-state';

  export let article;
  export let cardLayout = 'split';
  export let pending = false;
  export let imageFailed = false;
  export let href = '#';

  const dispatch = createEventDispatcher();

  const onReact = (value) => {
    dispatch('react', {
      articleId: article.id,
      value,
      feedId: article.source_feed_id ?? null
    });
  };

  const onToggleRead = () => {
    dispatch('toggleRead', {
      articleId: article.id,
      isRead: !isArticleRead(article)
    });
  };

  const onImageError = () => {
    dispatch('imageError', { articleId: article.id });
  };

  const onAcceptSuggestion = (suggestion) => {
    dispatch('acceptSuggestion', { articleId: article.id, suggestion });
  };

  const onDismissSuggestion = (suggestion) => {
    dispatch('dismissSuggestion', { articleId: article.id, suggestion });
  };

  const fitScoreValue = (score) => {
    const n = Number(score);
    return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
  };

  const fitScoreTone = (score) => {
    const value = fitScoreValue(score);
    if (value === null) return 'fit-none';
    return `fit-${value}`;
  };

  const fitScoreText = (score) => {
    const value = fitScoreValue(score);
    return value === null ? '--' : `${value}/5`;
  };

  const fitScoreAria = (score) => {
    const value = fitScoreValue(score);
    return value === null ? 'AI fit score not available yet' : `AI fit score ${value} out of 5`;
  };

  const formatPublished = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  };

  const sourceReputationLabel = (article) => {
    const feedbackCount = Number(article?.source_feedback_count ?? 0);
    const reputation = Number(article?.source_reputation ?? 0);
    if (!feedbackCount || !Number.isFinite(reputation)) return '';
    return `Source reputation ${reputation.toFixed(2)} from ${feedbackCount} votes`;
  };

  $: publishedLabel = formatPublished(article?.published_at ?? article?.fetched_at ?? null);
  $: visibleTags = Array.isArray(article?.tags) ? article.tags.slice(0, 4) : [];
  $: extraTagCount = Array.isArray(article?.tags) ? Math.max(0, article.tags.length - visibleTags.length) : 0;
  $: excerpt = article?.summary_text ?? article?.excerpt ?? '';
</script>

<article class={`article-card layout-${cardLayout}`} id={`article-${article.id}`}>
  <a
    class="visual-link"
    href={href}
    tabindex="-1"
    aria-hidden="true"
    data-sveltekit-reload="true"
  >
    {#if imageFailed}
      <div class="visual-fallback" aria-hidden="true">
        <span>{article?.source_name ?? 'Story'}</span>
      </div>
    {:else}
      <img
        class="visual-image"
        src={resolveArticleImageUrl(article)}
        alt=""
        loading="lazy"
        decoding="async"
        on:error={onImageError}
      />
    {/if}
  </a>

  <div class="card-body">
    <div class="meta-row">
      <span class="source-pill">{article?.source_name ?? 'Unknown source'}</span>
      {#if publishedLabel}
        <span class="published-label">{publishedLabel}</span>
      {/if}
    </div>

    <div class="headline-row">
      <div class="headline-copy">
        <h2>
          <a class="title-link" href={href} data-sveltekit-reload="true">
            {article?.title ?? 'Untitled article'}
          </a>
        </h2>
        {#if article?.author}
          <p class="byline">By {article.author}</p>
        {/if}
      </div>

      <div class="signal-stack">
        <span
          class={`fit-pill ${fitScoreTone(article?.score)}`}
          title={fitScoreAria(article?.score)}
          aria-label={fitScoreAria(article?.score)}
        >
          <IconStars size={13} stroke={1.9} />
          <span>{fitScoreText(article?.score)}</span>
        </span>
        <Pill variant={isArticleRead(article) ? 'muted' : 'default'}>
          {isArticleRead(article) ? 'Read' : 'Unread'}
        </Pill>
      </div>
    </div>

    {#if sourceReputationLabel(article)}
      <p class="reputation-note">{sourceReputationLabel(article)}</p>
    {/if}

    {#if excerpt}
      <p class="excerpt">{excerpt}</p>
    {/if}

    {#if visibleTags.length || extraTagCount > 0}
      <div class="tag-row" aria-label="Article tags">
        {#each visibleTags as tag}
          <span class="tag-pill">{tag.name}</span>
        {/each}
        {#if extraTagCount > 0}
          <span class="tag-pill more-tag">+{extraTagCount}</span>
        {/if}
      </div>
    {/if}

    {#if article?.tag_suggestions?.length}
      <div class="suggestion-row" aria-label="Suggested tags">
        {#each article.tag_suggestions as suggestion}
          <span class="suggestion-pill">
            <span>{suggestion.name}</span>
            <button
              type="button"
              class="suggestion-action"
              on:click={() => onAcceptSuggestion(suggestion)}
              title={`Accept suggested tag ${suggestion.name}`}
              aria-label={`Accept suggested tag ${suggestion.name}`}
              disabled={pending}
            >
              <IconPlus size={11} stroke={2} />
            </button>
            <button
              type="button"
              class="suggestion-action"
              on:click={() => onDismissSuggestion(suggestion)}
              title={`Dismiss suggested tag ${suggestion.name}`}
              aria-label={`Dismiss suggested tag ${suggestion.name}`}
              disabled={pending}
            >
              <IconX size={11} stroke={2} />
            </button>
          </span>
        {/each}
      </div>
    {/if}

    <div class="footer-row" class:pending>
      <div class="action-group">
        <button
          type="button"
          class="icon-button"
          class:active={reactionNumber(article?.reaction_value) === 1}
          on:click={() => onReact(1)}
          title="Thumbs up feed"
          aria-label="Thumbs up feed"
          disabled={pending}
        >
          <IconThumbUp size={16} stroke={1.9} />
        </button>
        <button
          type="button"
          class="icon-button"
          class:active={reactionNumber(article?.reaction_value) === -1}
          on:click={() => onReact(-1)}
          title="Thumbs down feed"
          aria-label="Thumbs down feed"
          disabled={pending}
        >
          <IconThumbDown size={16} stroke={1.9} />
        </button>
        <button
          type="button"
          class="read-button"
          on:click={onToggleRead}
          title={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
          aria-label={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
          disabled={pending}
        >
          {#if isArticleRead(article)}
            <IconEyeOff size={16} stroke={1.9} />
            <span>Mark unread</span>
          {:else}
            <IconEye size={16} stroke={1.9} />
            <span>Mark read</span>
          {/if}
        </button>
      </div>

      <a class="open-link" href={href} data-sveltekit-reload="true">
        Open article
      </a>
    </div>
  </div>
</article>

<style>
  .article-card {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    border-radius: clamp(1.3rem, 1.8vw, 1.75rem);
    border: 1px solid color-mix(in srgb, var(--surface-border) 110%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 92%, transparent), color-mix(in srgb, var(--surface) 90%, transparent)),
      radial-gradient(circle at top left, color-mix(in srgb, var(--primary-soft) 80%, transparent), transparent 48%);
    box-shadow: 0 16px 34px color-mix(in srgb, var(--shadow-color) 28%, transparent);
    overflow: clip;
    transition:
      transform var(--transition-fast),
      box-shadow var(--transition-fast),
      border-color var(--transition-fast);
  }

  .article-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 24px 48px color-mix(in srgb, var(--shadow-color) 36%, transparent);
    border-color: color-mix(in srgb, var(--primary) 26%, var(--surface-border));
  }

  .article-card.layout-split {
    grid-template-columns: minmax(220px, 250px) minmax(0, 1fr);
  }

  .visual-link {
    min-width: 0;
    display: block;
    background:
      linear-gradient(160deg, color-mix(in srgb, var(--primary-soft) 92%, transparent), transparent),
      linear-gradient(180deg, color-mix(in srgb, var(--nebula-b) 28%, transparent), color-mix(in srgb, var(--surface) 90%, transparent));
  }

  .layout-split .visual-link {
    height: 100%;
    min-height: 100%;
  }

  .layout-stacked .visual-link {
    aspect-ratio: 16 / 9;
  }

  .visual-image,
  .visual-fallback {
    width: 100%;
    height: 100%;
    display: block;
  }

  .visual-image {
    object-fit: cover;
  }

  .visual-fallback {
    min-height: 100%;
    display: grid;
    place-items: end start;
    padding: var(--space-5);
    color: color-mix(in srgb, var(--text-color) 90%, white 10%);
    font-size: var(--text-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .card-body {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
    padding: clamp(1rem, 1.8vw, 1.5rem);
  }

  .meta-row,
  .headline-row,
  .signal-stack,
  .footer-row,
  .tag-row,
  .suggestion-row,
  .action-group {
    min-width: 0;
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .source-pill,
  .published-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.8rem;
    padding: 0.28rem 0.7rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-soft) 88%, transparent);
    color: var(--muted-text);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .source-pill {
    color: var(--text-color);
    font-weight: 600;
  }

  .headline-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .headline-copy {
    min-width: 0;
    display: grid;
    gap: 0.45rem;
    flex: 1 1 auto;
  }

  h2 {
    margin: 0;
    font-size: clamp(1.15rem, 1.6vw, 1.5rem);
    line-height: 1.16;
    letter-spacing: -0.02em;
  }

  .title-link {
    color: var(--text-color);
    text-decoration: none;
    overflow-wrap: anywhere;
    text-wrap: balance;
    transition: color var(--transition-fast);
  }

  .title-link:hover {
    color: var(--primary);
  }

  .byline,
  .reputation-note {
    margin: 0;
    color: var(--muted-text);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .signal-stack {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
    flex-shrink: 0;
  }

  .fit-pill,
  .tag-pill,
  .suggestion-pill {
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: var(--radius-full);
    border: 1px solid color-mix(in srgb, var(--surface-border) 108%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 88%, transparent);
    padding: 0.34rem 0.72rem;
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .fit-pill {
    color: var(--muted-text);
    font-weight: 600;
    line-height: 1;
  }

  .fit-pill.fit-none {
    color: var(--muted-text);
  }

  .fit-pill.fit-1 {
    color: #fca5a5;
    background: rgba(252, 165, 165, 0.12);
    border-color: rgba(252, 165, 165, 0.25);
  }

  .fit-pill.fit-2 {
    color: #fdba74;
    background: rgba(253, 186, 116, 0.12);
    border-color: rgba(253, 186, 116, 0.25);
  }

  .fit-pill.fit-3 {
    color: #c4b5fd;
    background: rgba(196, 181, 253, 0.14);
    border-color: rgba(196, 181, 253, 0.26);
  }

  .fit-pill.fit-4 {
    color: #67e8f9;
    background: rgba(103, 232, 249, 0.14);
    border-color: rgba(103, 232, 249, 0.26);
  }

  .fit-pill.fit-5 {
    color: #86efac;
    background: rgba(134, 239, 172, 0.14);
    border-color: rgba(134, 239, 172, 0.26);
  }

  .excerpt {
    margin: 0;
    color: color-mix(in srgb, var(--text-color) 84%, var(--muted-text));
    font-size: clamp(0.98rem, 1.1vw, 1.05rem);
    line-height: 1.68;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .tag-row,
  .suggestion-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tag-pill {
    color: var(--muted-text);
  }

  .more-tag {
    color: var(--text-color);
    font-weight: 600;
  }

  .suggestion-pill {
    padding-right: 0.32rem;
    background: color-mix(in srgb, #4ade80 16%, var(--surface-soft));
  }

  .suggestion-action {
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }

  .footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding-top: var(--space-3);
    border-top: 1px solid color-mix(in srgb, var(--surface-border) 105%, transparent);
  }

  .footer-row.pending {
    opacity: 0.88;
  }

  .action-group {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .icon-button,
  .read-button,
  .open-link {
    min-height: 44px;
    min-width: 44px;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    font: inherit;
    transition:
      transform var(--transition-fast),
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast),
      opacity var(--transition-fast);
  }

  .icon-button,
  .read-button {
    border: 1px solid color-mix(in srgb, var(--surface-border) 115%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 90%, transparent);
    color: var(--text-color);
    cursor: pointer;
  }

  .icon-button {
    width: 44px;
    padding: 0;
  }

  .icon-button.active {
    color: var(--primary);
    background: color-mix(in srgb, var(--primary-soft) 82%, transparent);
    border-color: color-mix(in srgb, var(--primary) 28%, transparent);
  }

  .read-button {
    padding: 0.72rem 1rem;
  }

  .open-link {
    padding: 0.72rem 1rem;
    border: 1px solid color-mix(in srgb, var(--primary) 22%, transparent);
    background: linear-gradient(90deg, color-mix(in srgb, var(--primary-soft) 88%, transparent), color-mix(in srgb, var(--surface-soft) 92%, transparent));
    color: var(--text-color);
    text-decoration: none;
    font-weight: 600;
  }

  .icon-button:hover:not(:disabled),
  .read-button:hover:not(:disabled),
  .open-link:hover {
    transform: translateY(-1px);
  }

  .icon-button:disabled,
  .read-button:disabled,
  .suggestion-action:disabled {
    opacity: 0.6;
    cursor: default;
  }

  @media (max-width: 920px) {
    .article-card.layout-split,
    .article-card.layout-stacked {
      grid-template-columns: minmax(0, 1fr);
    }

    .visual-link {
      aspect-ratio: 16 / 9;
    }
  }

  @media (max-width: 640px) {
    .headline-row {
      display: grid;
      gap: var(--space-3);
    }

    .signal-stack {
      justify-content: flex-start;
    }

    .read-button,
    .open-link {
      flex: 1 1 12rem;
      min-width: 0;
    }

    .action-group {
      width: 100%;
    }
  }
</style>
