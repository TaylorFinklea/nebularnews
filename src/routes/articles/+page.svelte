<script>
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import {
    IconEye,
    IconEyeOff,
    IconFilterX,
    IconSearch,
    IconThumbDown,
    IconThumbUp
  } from '$lib/icons';
  import { resolveArticleImageUrl } from '$lib/article-image';
  export let data;
  const TOAST_TIMEOUT_MS = 4000;
  const DEFAULT_SCORE_FILTER = ['5', '4', '3', '2', '1', 'unscored'];
  const DEFAULT_REACTION_FILTER = ['up', 'down', 'none'];

  const scoreLabel = (score) => {
    if (!score) return 'Unscored';
    if (score >= 5) return 'Perfect fit';
    if (score >= 4) return 'Strong fit';
    if (score >= 3) return 'Okay fit';
    if (score >= 2) return 'Weak fit';
    return 'Not a fit';
  };

  const toInt = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const normalizeReadValue = (value) => (toInt(value, 0) === 1 ? 1 : 0);

  const reactionNumber = (value) => {
    const numeric = Number(value);
    if (numeric === 1) return 1;
    if (numeric === -1) return -1;
    return null;
  };

  const normalizeArticle = (article) => ({
    ...article,
    is_read: normalizeReadValue(article?.is_read),
    reaction_value: reactionNumber(article?.reaction_value),
    tags: Array.isArray(article?.tags) ? article.tags : []
  });

  let query = data.q ?? '';
  let selectedScores = [...(data.selectedScores ?? DEFAULT_SCORE_FILTER)];
  let readFilter = data.readFilter ?? 'all';
  let sort = data.sort ?? 'newest';
  let view = data.view ?? 'list';
  let cardLayout = data.layout ?? 'split';
  let selectedReactions = [...(data.selectedReactions ?? DEFAULT_REACTION_FILTER)];
  let selectedTagIds = [...(data.selectedTagIds ?? [])];
  let imageErrors = {};
  let serverArticles = [];
  let mergedArticles = [];
  let visibleArticles = [];
  let optimisticById = {};
  let pendingById = {};
  let uiMessage = '';
  let uiMessageTimer = null;
  let lastDataSyncKey = '';
  let lastServerArticlesKey = '';

  const syncFilterStateFromData = () => {
    const nextState = {
      q: data.q ?? '',
      selectedScores: data.selectedScores ?? DEFAULT_SCORE_FILTER,
      readFilter: data.readFilter ?? 'all',
      sort: data.sort ?? 'newest',
      view: data.view ?? 'list',
      layout: data.layout ?? 'split',
      selectedReactions: data.selectedReactions ?? DEFAULT_REACTION_FILTER,
      selectedTagIds: data.selectedTagIds ?? []
    };
    const nextKey = JSON.stringify(nextState);
    if (nextKey === lastDataSyncKey) return;
    lastDataSyncKey = nextKey;
    query = nextState.q;
    selectedScores = [...nextState.selectedScores];
    readFilter = nextState.readFilter;
    sort = nextState.sort;
    view = nextState.view;
    cardLayout = nextState.layout;
    selectedReactions = [...nextState.selectedReactions];
    selectedTagIds = [...nextState.selectedTagIds];
  };

  $: syncFilterStateFromData();

  const showUiMessage = (message) => {
    uiMessage = message;
    if (uiMessageTimer) clearTimeout(uiMessageTimer);
    uiMessageTimer = setTimeout(() => {
      uiMessage = '';
      uiMessageTimer = null;
    }, TOAST_TIMEOUT_MS);
  };

  onDestroy(() => {
    if (uiMessageTimer) clearTimeout(uiMessageTimer);
  });

  const setPending = (articleId, isPending) => {
    if (isPending) {
      pendingById = { ...pendingById, [articleId]: true };
      return;
    }
    if (!pendingById[articleId]) return;
    const next = { ...pendingById };
    delete next[articleId];
    pendingById = next;
  };

  const isPending = (articleId) => Boolean(pendingById[articleId]);

  const setOptimisticPatch = (articleId, patch) => {
    const current = optimisticById[articleId] ?? {};
    optimisticById = {
      ...optimisticById,
      [articleId]: {
        ...current,
        ...patch
      }
    };
  };

  const clearOptimisticFields = (articleId, fields) => {
    const current = optimisticById[articleId];
    if (!current) return;
    const next = { ...current };
    for (const field of fields) {
      delete next[field];
    }
    if (Object.keys(next).length === 0) {
      const nextOptimistic = { ...optimisticById };
      delete nextOptimistic[articleId];
      optimisticById = nextOptimistic;
      return;
    }
    optimisticById = {
      ...optimisticById,
      [articleId]: next
    };
  };

  $: {
    const nextServerArticles = (data.articles ?? []).map((article) => normalizeArticle(article));
    const nextServerArticlesKey = JSON.stringify(nextServerArticles);
    if (nextServerArticlesKey !== lastServerArticlesKey) {
      lastServerArticlesKey = nextServerArticlesKey;
      serverArticles = nextServerArticles;
    }
  }

  $: mergedArticles = serverArticles.map((article) => ({
    ...article,
    ...(optimisticById[article.id] ?? {})
  }));

  const isArticleRead = (article) => normalizeReadValue(article?.is_read) === 1;

  const scoreToken = (score) => {
    const numeric = toInt(score, NaN);
    if (Number.isNaN(numeric) || numeric < 1 || numeric > 5) return 'unscored';
    return String(numeric);
  };

  const articleHasSelectedTags = (article) => {
    if (selectedTagIds.length === 0) return true;
    const tagIds = new Set((article.tags ?? []).map((tag) => String(tag?.id ?? tag)));
    return selectedTagIds.every((tagId) => tagIds.has(String(tagId)));
  };

  const reactionFilterValue = (reactionValue) => {
    const normalized = reactionNumber(reactionValue);
    if (normalized === 1) return 'up';
    if (normalized === -1) return 'down';
    return 'none';
  };

  const matchesClientFilters = (article) => {
    if (!selectedScores.includes(scoreToken(article.score))) return false;
    if (readFilter === 'read' && !isArticleRead(article)) return false;
    if (readFilter === 'unread' && isArticleRead(article)) return false;
    if (selectedReactions.length === 0) return false;
    if (!selectedReactions.includes(reactionFilterValue(article.reaction_value))) return false;
    if (!articleHasSelectedTags(article)) return false;
    return true;
  };

  $: visibleArticles = mergedArticles.filter((article) => matchesClientFilters(article));

  const findMergedArticle = (articleId) => mergedArticles.find((article) => article.id === articleId) ?? null;

  const markImageError = (articleId) => {
    imageErrors = { ...imageErrors, [articleId]: true };
  };

  const imageFailed = (articleId) => Boolean(imageErrors[articleId]);

  const refreshInBackground = async () => {
    try {
      await invalidateAll();
      return true;
    } catch {
      // Ignore transient refresh failures; the next refresh cycle can retry.
      return false;
    }
  };

  const reactToArticle = async (articleId, value, feedId) => {
    if (isPending(articleId)) return;
    const currentArticle = findMergedArticle(articleId);
    if (!currentArticle) return;
    const previous = reactionNumber(currentArticle.reaction_value);
    setOptimisticPatch(articleId, { reaction_value: value });
    setPending(articleId, true);
    try {
      const res = await apiFetch(`/api/articles/${articleId}/reaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, feedId })
      });
      if (!res.ok) {
        throw new Error('reaction_failed');
      }
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { reaction_value: previous });
      clearOptimisticFields(articleId, ['reaction_value']);
      showUiMessage('Unable to save feed reaction. Reverted to previous state.');
    } finally {
      setPending(articleId, false);
    }
  };

  const setReadState = async (articleId, isRead) => {
    if (isPending(articleId)) return;
    const currentArticle = findMergedArticle(articleId);
    if (!currentArticle) return;
    const previous = normalizeReadValue(currentArticle.is_read);
    setOptimisticPatch(articleId, { is_read: isRead ? 1 : 0 });
    setPending(articleId, true);
    try {
      const res = await apiFetch(`/api/articles/${articleId}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead })
      });
      if (!res.ok) {
        throw new Error('read_state_failed');
      }
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { is_read: previous });
      clearOptimisticFields(articleId, ['is_read']);
      showUiMessage('Unable to save read state. Reverted to previous state.');
    } finally {
      setPending(articleId, false);
    }
  };

  const publishDateKey = (article) => {
    const sourceDate = article.published_at ?? article.fetched_at;
    if (!sourceDate) return 'undated';
    const parsed = new Date(sourceDate);
    if (Number.isNaN(parsed.getTime())) return 'undated';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const publishDateLabel = (article) => {
    const sourceDate = article.published_at ?? article.fetched_at;
    if (!sourceDate) return 'No publish date';
    const parsed = new Date(sourceDate);
    if (Number.isNaN(parsed.getTime())) return 'No publish date';
    return parsed.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const pageHref = (nextPage) => {
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    for (const score of data.selectedScores ?? []) params.append('score', score);
    if (data.readFilter && data.readFilter !== 'all') params.set('read', data.readFilter);
    if (data.sort && data.sort !== 'newest') params.set('sort', data.sort);
    if (data.view && data.view !== 'list') params.set('view', data.view);
    for (const reaction of data.selectedReactions ?? []) params.append('reaction', reaction);
    for (const tagId of data.selectedTagIds ?? []) params.append('tags', tagId);
    params.set('page', String(nextPage));
    return `/articles?${params.toString()}`;
  };

  const articleHref = (articleId) => {
    const currentPage = data.pagination?.page ?? 1;
    const from = `${pageHref(currentPage)}#article-${articleId}`;
    return `/articles/${articleId}?from=${encodeURIComponent(from)}`;
  };
</script>

<section class="page-header">
  <div>
    <h1>Articles</h1>
    <p>Review summaries and tune the relevance score.</p>
  </div>
</section>
{#if uiMessage}
  <p class="status-toast" role="status" aria-live="polite">{uiMessage}</p>
{/if}

<form class="filters" method="get">
  <input name="q" placeholder="Search headlines and summaries" bind:value={query} />
  <fieldset class="score-filter">
    <legend>Scores</legend>
    <label>
      <input type="checkbox" name="score" value="5" bind:group={selectedScores} />
      <span>5</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="4" bind:group={selectedScores} />
      <span>4</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="3" bind:group={selectedScores} />
      <span>3</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="2" bind:group={selectedScores} />
      <span>2</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="1" bind:group={selectedScores} />
      <span>1</span>
    </label>
    <label>
      <input type="checkbox" name="score" value="unscored" bind:group={selectedScores} />
      <span>Unscored</span>
    </label>
    <button
      type="button"
      class="score-all ghost"
      on:click={() => (selectedScores = ['5', '4', '3', '2', '1', 'unscored'])}
    >
      All
    </button>
  </fieldset>
  <select name="read" bind:value={readFilter}>
    <option value="all">All articles</option>
    <option value="unread">Unread only</option>
    <option value="read">Read only</option>
  </select>
  <select name="sort" bind:value={sort}>
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="score_desc">Score high-low</option>
    <option value="score_asc">Score low-high</option>
    <option value="unread_first">Unread first</option>
    <option value="title_az">Title A-Z</option>
  </select>
  <fieldset class="view-toggle">
    <legend>View</legend>
    <label>
      <input type="radio" name="view" value="list" bind:group={view} />
      <span>List</span>
    </label>
    <label>
      <input type="radio" name="view" value="grouped" bind:group={view} />
      <span>Group by date</span>
    </label>
  </fieldset>
  <fieldset class="reaction-filter">
    <legend>Reactions</legend>
    <label>
      <input type="checkbox" name="reaction" value="up" bind:group={selectedReactions} />
      <span>Up</span>
    </label>
    <label>
      <input type="checkbox" name="reaction" value="none" bind:group={selectedReactions} />
      <span>None</span>
    </label>
    <label>
      <input type="checkbox" name="reaction" value="down" bind:group={selectedReactions} />
      <span>Down</span>
    </label>
    <button
      type="button"
      class="reaction-all ghost"
      on:click={() => (selectedReactions = ['up', 'none', 'down'])}
    >
      All
    </button>
  </fieldset>
  <select name="tags" multiple bind:value={selectedTagIds} size="4">
    {#each data.availableTags ?? [] as tag}
      <option value={tag.id}>{tag.name} ({tag.article_count})</option>
    {/each}
  </select>
  <button type="submit" class="icon-button" title="Apply filters" aria-label="Apply filters">
    <IconSearch size={16} stroke={1.9} />
    <span class="sr-only">Apply filters</span>
  </button>
  {#if selectedTagIds.length > 0}
    <a class="clear-link icon-link" href="/articles" title="Clear tag filters" data-sveltekit-reload="true">
      <IconFilterX size={14} stroke={1.9} />
      <span>Clear</span>
    </a>
  {/if}
</form>

<div class="pagination-meta">
  <span>
    Showing {data.pagination?.start ?? 0}-{data.pagination?.end ?? 0}
    of {data.pagination?.total ?? 0}
  </span>
  {#if (data.pagination?.totalPages ?? 1) > 1}
    <nav class="pagination" aria-label="Article pages">
      {#if data.pagination?.hasPrev}
        <a class="ghost page-link" href={pageHref((data.pagination?.page ?? 1) - 1)} data-sveltekit-reload="true">Prev</a>
      {:else}
        <span class="ghost page-link disabled" aria-disabled="true">Prev</span>
      {/if}
      <span class="page-current">Page {data.pagination?.page ?? 1} / {data.pagination?.totalPages ?? 1}</span>
      {#if data.pagination?.hasNext}
        <a class="ghost page-link" href={pageHref((data.pagination?.page ?? 1) + 1)} data-sveltekit-reload="true">Next</a>
      {:else}
        <span class="ghost page-link disabled" aria-disabled="true">Next</span>
      {/if}
    </nav>
  {/if}
</div>

<div class="articles">
  {#if visibleArticles.length === 0}
    <p class="muted">No articles yet. Add feeds to start pulling stories.</p>
  {:else}
    {#each visibleArticles as article, index (article.id)}
      {#if view === 'grouped'}
        {@const currentDateKey = publishDateKey(article)}
        {@const previousDateKey = index > 0 ? publishDateKey(visibleArticles[index - 1]) : null}
        {#if currentDateKey !== previousDateKey}
          <h2 class="date-group-heading">{publishDateLabel(article)}</h2>
        {/if}
      {/if}
      <article class={`card layout-${cardLayout}`} id={`article-${article.id}`}>
        <a
          class="card-image-link"
          href={articleHref(article.id)}
          title="Open article"
          aria-label="Open article"
          data-sveltekit-reload="true"
        >
          {#if imageFailed(article.id)}
            <div class="image-fallback" aria-hidden="true">No image</div>
          {:else}
            <img
              class="card-image"
              src={resolveArticleImageUrl(article)}
              alt={article.title ?? 'Article image'}
              loading="lazy"
              decoding="async"
              on:error={() => markImageError(article.id)}
            />
          {/if}
        </a>
        <div class="card-main">
          <div class="card-head">
            <h2>
              <a class="title-link" href={articleHref(article.id)} data-sveltekit-reload="true">
                {article.title ?? 'Untitled article'}
              </a>
            </h2>
            <div class="pills">
              <span class={`pill ${isArticleRead(article) ? 'read' : 'unread'}`}>
                {isArticleRead(article) ? 'Read' : 'Unread'}
              </span>
              <span class="pill">{scoreLabel(article.score)}</span>
            </div>
          </div>
          <div class="meta">
            <span>
              {article.source_name ?? 'Unknown source'}
              {#if article.source_feedback_count}
                · rep {article.source_reputation.toFixed(2)} ({article.source_feedback_count} votes)
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
        <div class="action-row" class:pending={isPending(article.id)}>
          <div class="reactions">
            <button
              type="button"
              class="icon-button"
              class:active={reactionNumber(article.reaction_value) === 1}
              on:click={() => reactToArticle(article.id, 1, article.source_feed_id)}
              title="Thumbs up feed"
              aria-label="Thumbs up feed"
              disabled={isPending(article.id)}
            >
              <IconThumbUp size={16} stroke={1.9} />
              <span class="sr-only">Thumbs up feed</span>
            </button>
            <button
              type="button"
              class="icon-button"
              class:active={reactionNumber(article.reaction_value) === -1}
              on:click={() => reactToArticle(article.id, -1, article.source_feed_id)}
              title="Thumbs down feed"
              aria-label="Thumbs down feed"
              disabled={isPending(article.id)}
            >
              <IconThumbDown size={16} stroke={1.9} />
              <span class="sr-only">Thumbs down feed</span>
            </button>
          </div>
          <button
            type="button"
            class="ghost icon-button"
            on:click={() => setReadState(article.id, !isArticleRead(article))}
            title={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
            aria-label={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
            disabled={isPending(article.id)}
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
    {/each}
  {/if}
</div>

{#if (data.pagination?.totalPages ?? 1) > 1}
  <div class="pagination-bottom">
    <nav class="pagination" aria-label="Article pages bottom">
      {#if data.pagination?.hasPrev}
        <a class="ghost page-link" href={pageHref((data.pagination?.page ?? 1) - 1)} data-sveltekit-reload="true">Prev</a>
      {:else}
        <span class="ghost page-link disabled" aria-disabled="true">Prev</span>
      {/if}
      <span class="page-current">Page {data.pagination?.page ?? 1} / {data.pagination?.totalPages ?? 1}</span>
      {#if data.pagination?.hasNext}
        <a class="ghost page-link" href={pageHref((data.pagination?.page ?? 1) + 1)} data-sveltekit-reload="true">Next</a>
      {:else}
        <span class="ghost page-link disabled" aria-disabled="true">Next</span>
      {/if}
    </nav>
  </div>
{/if}

<style>
  .status-toast {
    margin: 0 0 1rem;
    padding: 0.65rem 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    color: var(--text-color);
    font-size: 0.86rem;
  }

  .articles {
    display: grid;
    gap: 1.5rem;
  }

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

  .filters {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }

  input:not([type='checkbox']),
  select {
    padding: 0.6rem 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
    font-family: inherit;
  }

  select {
    min-width: 180px;
  }

  select[multiple] {
    min-width: 230px;
    min-height: 126px;
  }

  form button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .icon-button {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .clear-link {
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .pagination-meta {
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    color: var(--muted-text);
    font-size: 0.88rem;
    flex-wrap: wrap;
  }

  .pagination-bottom {
    margin-top: 1rem;
    display: flex;
    justify-content: center;
  }

  .pagination {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .page-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 3rem;
    border: 1px solid var(--ghost-border);
    border-radius: 999px;
    padding: 0.25rem 0.7rem;
    color: var(--ghost-color);
    text-decoration: none;
  }

  .page-link.disabled {
    opacity: 0.45;
    cursor: default;
  }

  .page-current {
    color: var(--muted-text);
    font-size: 0.85rem;
    min-width: 6.6rem;
    text-align: center;
  }

  .score-filter,
  .reaction-filter,
  .view-toggle {
    border: 1px solid var(--input-border);
    border-radius: 12px;
    padding: 0.45rem 0.6rem;
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
    min-width: 260px;
  }

  .score-filter legend,
  .reaction-filter legend,
  .view-toggle legend {
    font-size: 0.75rem;
    color: var(--muted-text);
    padding: 0 0.25rem;
  }

  .score-filter label,
  .reaction-filter label,
  .view-toggle label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.82rem;
    color: var(--muted-text);
  }

  .score-filter input[type='checkbox'],
  .reaction-filter input[type='checkbox'] {
    margin: 0;
    accent-color: var(--primary);
  }

  .view-toggle input[type='radio'] {
    margin: 0;
    accent-color: var(--primary);
  }

  .score-all,
  .reaction-all {
    margin-left: auto;
    border: 1px solid var(--ghost-border);
    background: transparent;
    color: var(--ghost-color);
    cursor: pointer;
    border-radius: 999px;
    padding: 0.18rem 0.55rem;
    font-size: 0.78rem;
    line-height: 1.2;
  }

  .muted {
    color: var(--muted-text);
  }

  .date-group-heading {
    margin: 0.5rem 0 0.1rem;
    color: var(--muted-text);
    font-size: 0.9rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  @media (max-width: 700px) {
    .filters {
      flex-direction: column;
      align-items: stretch;
    }

    .card.layout-split,
    .card.layout-stacked {
      grid-template-columns: 1fr;
    }

    .card.layout-split .card-image-link,
    .card.layout-stacked .card-image-link {
      width: 100%;
      max-width: none;
      height: auto;
      aspect-ratio: 16 / 9;
    }

    .card.layout-split,
    .card.layout-stacked {
      grid-template-areas:
        'image'
        'main'
        'actions';
    }

    .card-image {
      height: 100%;
    }
  }
</style>
