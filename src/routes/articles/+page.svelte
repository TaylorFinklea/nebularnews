<script>
  import { onDestroy } from 'svelte';
  import ArticleCard from '$lib/components/articles/ArticleCard.svelte';
  import ArticleDateGroupHeading from '$lib/components/articles/ArticleDateGroupHeading.svelte';
  import ArticleFilters from '$lib/components/articles/ArticleFilters.svelte';
  import ArticlePagination from '$lib/components/articles/ArticlePagination.svelte';
  import { createArticlesState } from '$lib/client/articles/articles-state';

  export let data;

  const DEFAULT_SCORE_FILTER = ['5', '4', '3', '2', '1', 'unscored'];
  const DEFAULT_REACTION_FILTER = ['up', 'down', 'none'];

  let query = data.q ?? '';
  let selectedScores = [...(data.selectedScores ?? DEFAULT_SCORE_FILTER)];
  let readFilter = data.readFilter ?? 'all';
  let sort = data.sort ?? 'newest';
  let view = data.view ?? 'list';
  let cardLayout = data.layout ?? 'split';
  let selectedReactions = [...(data.selectedReactions ?? DEFAULT_REACTION_FILTER)];
  let selectedTagIds = [...(data.selectedTagIds ?? [])];
  let visibleArticles = [];
  let lastDataSyncKey = '';

  const optimisticMutationsEnabled = data.optimisticMutationsEnabled !== false;
  const articlesState = createArticlesState(data.articles ?? []);

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
  $: articlesState.syncFromServer(data.articles ?? []);
  $: {
    // Depend on store updates so optimistic/pending state is reflected immediately.
    $articlesState;
    visibleArticles = articlesState.getVisibleArticles({
      selectedScores,
      selectedReactions,
      selectedTagIds,
      readFilter
    });
  }

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

  const handleReact = async (event) => {
    const detail = event.detail;
    await articlesState.reactToArticle(detail.articleId, detail.value, detail.feedId, {
      optimisticEnabled: optimisticMutationsEnabled
    });
  };

  const handleToggleRead = async (event) => {
    const detail = event.detail;
    await articlesState.setReadState(detail.articleId, detail.isRead, {
      optimisticEnabled: optimisticMutationsEnabled
    });
  };

  const handleImageError = (event) => {
    const detail = event.detail;
    articlesState.markImageError(detail.articleId);
  };

  onDestroy(() => {
    articlesState.destroy();
  });
</script>

<section class="page-header">
  <div>
    <h1>Articles</h1>
    <p>Review summaries and tune the relevance score.</p>
  </div>
</section>

{#if $articlesState.uiMessage}
  <p class="status-toast" role="status" aria-live="polite">{$articlesState.uiMessage}</p>
{/if}

<ArticleFilters
  bind:query
  bind:selectedScores
  bind:readFilter
  bind:sort
  bind:view
  bind:selectedReactions
  bind:selectedTagIds
  availableTags={data.availableTags ?? []}
  clearHref="/articles"
/>

<div class="pagination-meta">
  <span>
    Showing {data.pagination?.start ?? 0}-{data.pagination?.end ?? 0}
    of {data.pagination?.total ?? 0}
  </span>
  {#if (data.pagination?.totalPages ?? 1) > 1}
    <ArticlePagination pagination={data.pagination} {pageHref} ariaLabel="Article pages" />
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
          <ArticleDateGroupHeading label={publishDateLabel(article)} />
        {/if}
      {/if}
      <ArticleCard
        {article}
        {cardLayout}
        pending={Boolean($articlesState.pendingById[article.id])}
        imageFailed={Boolean($articlesState.imageErrors[article.id])}
        href={articleHref(article.id)}
        on:react={handleReact}
        on:toggleRead={handleToggleRead}
        on:imageError={handleImageError}
      />
    {/each}
  {/if}
</div>

{#if (data.pagination?.totalPages ?? 1) > 1}
  <div class="pagination-bottom">
    <ArticlePagination pagination={data.pagination} {pageHref} ariaLabel="Article pages bottom" />
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

  .muted {
    color: var(--muted-text);
  }
</style>
