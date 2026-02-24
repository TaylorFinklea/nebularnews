<script>
  import { createEventDispatcher } from 'svelte';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import { IconEye, IconEyeOff, IconStars, IconThumbDown, IconThumbUp } from '$lib/icons';
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
</script>

<article class={`card layout-${cardLayout}`} id={`article-${article.id}`}>
  <a
    class="card-image-link"
    href={href}
    title="Open article"
    aria-label="Open article"
  >
    {#if imageFailed}
      <div class="image-fallback" aria-hidden="true">No image</div>
    {:else}
      <img
        class="card-image"
        src={resolveArticleImageUrl(article)}
        alt={article.title ?? 'Article image'}
        loading="lazy"
        decoding="async"
        on:error={onImageError}
      />
    {/if}
  </a>
  <div class="card-main">
    <div class="card-head">
      <h2>
        <a class="title-link" href={href}>
          {article.title ?? 'Untitled article'}
        </a>
      </h2>
      <div class="pills">
        <span
          class={`fit-pill ${fitScoreTone(article.score)}`}
          title={fitScoreAria(article.score)}
          aria-label={fitScoreAria(article.score)}
        >
          <IconStars size={13} stroke={1.9} />
          <span>{fitScoreText(article.score)}</span>
        </span>
        <span class={`pill ${isArticleRead(article) ? 'read' : 'unread'}`}>
          {isArticleRead(article) ? 'Read' : 'Unread'}
        </span>
      </div>
    </div>
    <div class="meta">
      <span>
        {article.source_name ?? 'Unknown source'}
        {#if article.source_feedback_count}
          · rep {Number(article.source_reputation ?? 0).toFixed(2)} ({article.source_feedback_count} votes)
        {/if}
      </span>
      <span>{article.published_at ? new Date(article.published_at).toLocaleString() : ''}</span>
    </div>
    {#if article.author}
      <div class="byline">By {article.author}</div>
    {/if}
    {#if article.tags?.length}
      <div class="tag-row">
        {#each article.tags as tag}
          <span class="tag-pill">{tag.name}</span>
        {/each}
      </div>
    {/if}
    <p class="excerpt">{article.summary_text ?? article.excerpt ?? ''}</p>
  </div>
  <div class="action-row" class:pending>
    <div class="reactions">
      <button
        type="button"
        class="icon-button"
        class:active={reactionNumber(article.reaction_value) === 1}
        on:click={() => onReact(1)}
        title="Thumbs up feed"
        aria-label="Thumbs up feed"
        disabled={pending}
      >
        <IconThumbUp size={16} stroke={1.9} />
        <span class="sr-only">Thumbs up feed</span>
      </button>
      <button
        type="button"
        class="icon-button"
        class:active={reactionNumber(article.reaction_value) === -1}
        on:click={() => onReact(-1)}
        title="Thumbs down feed"
        aria-label="Thumbs down feed"
        disabled={pending}
      >
        <IconThumbDown size={16} stroke={1.9} />
        <span class="sr-only">Thumbs down feed</span>
      </button>
    </div>
    <button
      type="button"
      class="ghost icon-button"
      on:click={onToggleRead}
      title={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
      aria-label={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
      disabled={pending}
    >
      {#if isArticleRead(article)}
        <IconEyeOff size={16} stroke={1.9} />
        <span class="sr-only">Mark unread</span>
      {:else}
        <IconEye size={16} stroke={1.9} />
        <span class="sr-only">Mark read</span>
      {/if}
    </button>
  </div>
</article>

<style>
  .card {
    background: var(--surface-strong);
    padding: 1.6rem;
    border-radius: 22px;
    box-shadow: 0 16px 30px var(--shadow-color);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: 1rem;
    align-items: start;
  }

  .card.layout-split {
    grid-template-columns: 180px minmax(0, 1fr);
    grid-template-areas:
      'image main'
      'actions actions';
  }

  .card.layout-stacked {
    grid-template-columns: 1fr;
    grid-template-areas:
      'image'
      'main'
      'actions';
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .card-image-link {
    grid-area: image;
    display: block;
    border-radius: 14px;
    overflow: hidden;
    background: linear-gradient(145deg, rgba(83, 118, 255, 0.24), rgba(69, 36, 199, 0.12));
    border: 1px solid var(--surface-border);
  }

  .card.layout-split .card-image-link {
    width: 100%;
    height: 126px;
  }

  .card.layout-stacked .card-image-link {
    width: 100%;
    max-width: 560px;
    max-height: 220px;
  }

  .card-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    background: linear-gradient(145deg, rgba(83, 118, 255, 0.24), rgba(69, 36, 199, 0.12));
  }

  .image-fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--muted-text);
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .card-main {
    grid-area: main;
    display: grid;
    gap: 0.7rem;
    min-width: 0;
    align-content: start;
  }

  .card h2 {
    margin: 0;
    font-size: 1.02rem;
  }

  .title-link {
    color: var(--text-color);
    text-decoration: none;
  }

  .title-link:hover {
    color: var(--primary);
  }

  .pills {
    display: inline-flex;
    gap: 0.5rem;
  }

  .fit-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: 999px;
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    color: var(--muted-text);
    padding: 0.3rem 0.62rem;
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1;
  }

  .fit-pill.fit-none {
    color: var(--muted-text);
    border-color: var(--input-border);
  }

  .fit-pill.fit-1 {
    color: #fca5a5;
    border-color: rgba(252, 165, 165, 0.42);
    background: rgba(252, 165, 165, 0.12);
  }

  .fit-pill.fit-2 {
    color: #fdba74;
    border-color: rgba(253, 186, 116, 0.42);
    background: rgba(253, 186, 116, 0.12);
  }

  .fit-pill.fit-3 {
    color: #c4b5fd;
    border-color: rgba(196, 181, 253, 0.45);
    background: rgba(196, 181, 253, 0.14);
  }

  .fit-pill.fit-4 {
    color: #67e8f9;
    border-color: rgba(103, 232, 249, 0.45);
    background: rgba(103, 232, 249, 0.14);
  }

  .fit-pill.fit-5 {
    color: #86efac;
    border-color: rgba(134, 239, 172, 0.45);
    background: rgba(134, 239, 172, 0.14);
  }

  .pill {
    background: var(--primary-soft);
    color: var(--primary);
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .pill.read {
    background: var(--surface-soft);
    color: var(--muted-text);
  }

  .pill.unread {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .excerpt {
    margin: 0;
    color: var(--muted-text);
    display: -webkit-box;
    -webkit-line-clamp: 8;
    line-clamp: 8;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.92rem;
    line-height: 1.45;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--muted-text);
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .byline {
    font-size: 0.85rem;
    color: var(--muted-text);
  }

  .action-row {
    grid-area: actions;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 0.7rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--surface-border);
  }

  .action-row.pending {
    opacity: 0.9;
  }

  .reactions {
    display: inline-flex;
    gap: 0.5rem;
  }

  .reactions button {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    border-radius: 999px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color);
    width: 2.1rem;
    height: 2.1rem;
  }

  .reactions button.active {
    border-color: var(--ghost-border);
    background: var(--primary-soft);
    color: var(--primary);
  }

  .action-row button:disabled {
    opacity: 0.62;
    cursor: wait;
  }

  .ghost {
    border: 1px solid var(--ghost-border);
    background: transparent;
    color: var(--ghost-color);
    border-radius: 999px;
    padding: 0;
    cursor: pointer;
    width: 2.1rem;
    height: 2.1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .tag-row {
    margin-top: 0.7rem;
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .tag-pill {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    font-size: 0.78rem;
    color: var(--muted-text);
  }

  @media (max-width: 700px) {
    .card.layout-split,
    .card.layout-stacked {
      grid-template-columns: 1fr;
      grid-template-areas:
        'image'
        'main'
        'actions';
    }

    .card.layout-split .card-image-link,
    .card.layout-stacked .card-image-link {
      width: 100%;
      max-width: none;
      height: auto;
      aspect-ratio: 16 / 9;
    }

    .card-image {
      height: 100%;
    }
  }
</style>
