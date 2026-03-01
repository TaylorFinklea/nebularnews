<script>
  import { invalidateAll } from '$app/navigation';
  import { apiFetch } from '$lib/client/api-fetch';
  import { IconAdjustments, IconFilterX } from '$lib/icons';
  import ArticleCard from '$lib/components/articles/ArticleCard.svelte';
  import ArticleFilters from '$lib/components/articles/ArticleFilters.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import { showToast } from '$lib/client/toast';
  export let data;

  const DEFAULT_SCORE_FILTER = ['5', '4', '3', '2', '1', 'unscored'];
  const DEFAULT_REACTION_FILTER = ['up', 'down', 'none'];

  const toInt = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
  const normalizeReadValue = (value) => (toInt(value, 0) === 1 ? 1 : 0);
  const reactionNumber = (value) => { const n = Number(value); if (n === 1) return 1; if (n === -1) return -1; return null; };
  const normalizeArticle = (article) => ({
    ...article,
    is_read: normalizeReadValue(article?.is_read),
    reaction_value: reactionNumber(article?.reaction_value),
    tags: Array.isArray(article?.tags) ? article.tags : [],
    tag_suggestions: Array.isArray(article?.tag_suggestions) ? article.tag_suggestions : []
  });

  let query = data.q ?? '';
  let selectedScores = [...(data.selectedScores ?? DEFAULT_SCORE_FILTER)];
  let readFilter = data.readFilter ?? 'all';
  let sinceDays = data.sinceDays ?? null;
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
  let lastDataSyncKey = '';
  let lastServerArticlesKey = '';
  let filtersOpen = false;
  let statusMessage = '';

  const syncFilterStateFromData = () => {
    const nextState = { q: data.q ?? '', selectedScores: data.selectedScores ?? DEFAULT_SCORE_FILTER, readFilter: data.readFilter ?? 'all', sinceDays: data.sinceDays ?? null, sort: data.sort ?? 'newest', view: data.view ?? 'list', layout: data.layout ?? 'split', selectedReactions: data.selectedReactions ?? DEFAULT_REACTION_FILTER, selectedTagIds: data.selectedTagIds ?? [] };
    const nextKey = JSON.stringify(nextState);
    if (nextKey === lastDataSyncKey) return;
    lastDataSyncKey = nextKey;
    query = nextState.q; selectedScores = [...nextState.selectedScores]; readFilter = nextState.readFilter; sinceDays = nextState.sinceDays;
    sort = nextState.sort; view = nextState.view; cardLayout = nextState.layout;
    selectedReactions = [...nextState.selectedReactions]; selectedTagIds = [...nextState.selectedTagIds];
  };

  $: syncFilterStateFromData();

  const setPending = (articleId, isPending) => {
    if (isPending) { pendingById = { ...pendingById, [articleId]: true }; return; }
    if (!pendingById[articleId]) return;
    const next = { ...pendingById }; delete next[articleId]; pendingById = next;
  };

  const isPending = (articleId) => Boolean(pendingById[articleId]);

  const setOptimisticPatch = (articleId, patch) => {
    optimisticById = { ...optimisticById, [articleId]: { ...(optimisticById[articleId] ?? {}), ...patch } };
  };

  const clearOptimisticFields = (articleId, fields) => {
    const current = optimisticById[articleId];
    if (!current) return;
    const next = { ...current };
    for (const field of fields) delete next[field];
    if (Object.keys(next).length === 0) { const n = { ...optimisticById }; delete n[articleId]; optimisticById = n; return; }
    optimisticById = { ...optimisticById, [articleId]: next };
  };

  $: {
    const nextServerArticles = (data.articles ?? []).map(normalizeArticle);
    const nextKey = JSON.stringify(nextServerArticles);
    if (nextKey !== lastServerArticlesKey) { lastServerArticlesKey = nextKey; serverArticles = nextServerArticles; }
  }

  $: mergedArticles = serverArticles.map((a) => ({ ...a, ...(optimisticById[a.id] ?? {}) }));

  const isArticleRead = (article) => normalizeReadValue(article?.is_read) === 1;
  const scoreToken = (score) => { const n = toInt(score, NaN); if (Number.isNaN(n) || n < 1 || n > 5) return 'unscored'; return String(n); };
  const articleHasSelectedTags = (article) => { if (selectedTagIds.length === 0) return true; const tagIds = new Set((article.tags ?? []).map((t) => String(t?.id ?? t))); return selectedTagIds.every((id) => tagIds.has(String(id))); };
  const reactionFilterValue = (rv) => { const n = reactionNumber(rv); if (n === 1) return 'up'; if (n === -1) return 'down'; return 'none'; };
  const matchesClientFilters = (article) => {
    if (!selectedScores.includes(scoreToken(article.score))) return false;
    if (readFilter === 'read' && !isArticleRead(article)) return false;
    if (readFilter === 'unread' && isArticleRead(article)) return false;
    if (selectedReactions.length === 0) return false;
    if (!selectedReactions.includes(reactionFilterValue(article.reaction_value))) return false;
    if (!articleHasSelectedTags(article)) return false;
    return true;
  };

  $: visibleArticles = mergedArticles.filter(matchesClientFilters);
  const findMergedArticle = (id) => mergedArticles.find((a) => a.id === id) ?? null;
  const markImageError = (id) => { imageErrors = { ...imageErrors, [id]: true }; };
  const imageFailed = (id) => Boolean(imageErrors[id]);
  const refreshInBackground = async () => { try { await invalidateAll(); return true; } catch { return false; } };
  const responseField = (payload, key, fallback) => payload?.data?.[key] ?? payload?.[key] ?? fallback;

  const reactToArticle = async (articleId, value, feedId) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    const previous = reactionNumber(current.reaction_value);
    setOptimisticPatch(articleId, { reaction_value: value });
    setPending(articleId, true);
    try {
      const res = await apiFetch(`/api/articles/${articleId}/reaction`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value, feedId }) });
      if (!res.ok) throw new Error('reaction_failed');
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { reaction_value: previous });
      clearOptimisticFields(articleId, ['reaction_value']);
      statusMessage = 'Unable to save feed reaction. Reverted.';
      showToast('Unable to save feed reaction. Reverted.', 'error');
    } finally {
      setPending(articleId, false);
    }
  };

  const setReadState = async (articleId, isRead) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    const previous = normalizeReadValue(current.is_read);
    setOptimisticPatch(articleId, { is_read: isRead ? 1 : 0 });
    setPending(articleId, true);
    try {
      const res = await apiFetch(`/api/articles/${articleId}/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isRead }) });
      if (!res.ok) throw new Error('read_state_failed');
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { is_read: previous });
      clearOptimisticFields(articleId, ['is_read']);
      showToast('Unable to save read state. Reverted.', 'error');
    } finally {
      setPending(articleId, false);
    }
  };

  const acceptTagSuggestion = async (articleId, suggestion) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    const previousTags = Array.isArray(current.tags) ? current.tags : [];
    const previousSuggestions = Array.isArray(current.tag_suggestions) ? current.tag_suggestions : [];
    setPending(articleId, true);
    setOptimisticPatch(articleId, {
      tags: [...previousTags, { id: `pending-${suggestion.name_normalized}`, name: suggestion.name }],
      tag_suggestions: previousSuggestions.filter((entry) => entry.id !== suggestion.id)
    });
    try {
      const res = await apiFetch(`/api/articles/${articleId}/tag-suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'accept', suggestionId: suggestion.id })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message ?? payload?.error ?? 'accept_failed');
      setOptimisticPatch(articleId, {
        tags: responseField(payload, 'tags', previousTags),
        tag_suggestions: responseField(payload, 'suggestions', previousSuggestions)
      });
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { tags: previousTags, tag_suggestions: previousSuggestions });
      showToast('Unable to accept tag suggestion. Reverted.', 'error');
    } finally {
      setPending(articleId, false);
    }
  };

  const undoDismissTagSuggestion = async (articleId, suggestion) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    const previousSuggestions = Array.isArray(current.tag_suggestions) ? current.tag_suggestions : [];
    setPending(articleId, true);
    setOptimisticPatch(articleId, {
      tag_suggestions: [...previousSuggestions, suggestion]
    });
    try {
      const res = await apiFetch(`/api/articles/${articleId}/tag-suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'undo_dismiss',
          name: suggestion.name,
          confidence: suggestion.confidence ?? null,
          sourceProvider: suggestion.source_provider ?? null,
          sourceModel: suggestion.source_model ?? null
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message ?? payload?.error ?? 'undo_dismiss_failed');
      setOptimisticPatch(articleId, {
        tag_suggestions: responseField(payload, 'suggestions', previousSuggestions)
      });
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { tag_suggestions: previousSuggestions });
      showToast('Unable to undo suggestion dismissal.', 'error');
    } finally {
      setPending(articleId, false);
    }
  };

  const dismissTagSuggestion = async (articleId, suggestion) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    const previousSuggestions = Array.isArray(current.tag_suggestions) ? current.tag_suggestions : [];
    setPending(articleId, true);
    setOptimisticPatch(articleId, {
      tag_suggestions: previousSuggestions.filter((entry) => entry.id !== suggestion.id)
    });
    try {
      const res = await apiFetch(`/api/articles/${articleId}/tag-suggestions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', suggestionId: suggestion.id })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message ?? payload?.error ?? 'dismiss_failed');
      setOptimisticPatch(articleId, {
        tag_suggestions: responseField(payload, 'suggestions', previousSuggestions)
      });
      showToast('Suggestion dismissed.', 'info', {
        durationMs: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            void undoDismissTagSuggestion(articleId, suggestion);
          }
        }
      });
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, { tag_suggestions: previousSuggestions });
      showToast('Unable to dismiss tag suggestion. Reverted.', 'error');
    } finally {
      setPending(articleId, false);
    }
  };

  const publishDateKey = (article) => {
    const src = article.published_at ?? article.fetched_at;
    if (!src) return 'undated';
    const p = new Date(src);
    if (Number.isNaN(p.getTime())) return 'undated';
    return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
  };

  const publishDateLabel = (article) => {
    const src = article.published_at ?? article.fetched_at;
    if (!src) return 'No publish date';
    const p = new Date(src);
    if (Number.isNaN(p.getTime())) return 'No publish date';
    return p.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  const pageHref = (nextPage) => {
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    for (const score of data.selectedScores ?? []) params.append('score', score);
    if (data.readFilter && data.readFilter !== 'all') params.set('read', data.readFilter);
    if (data.sinceDays) params.set('sinceDays', String(data.sinceDays));
    if (data.sort && data.sort !== 'newest') params.set('sort', data.sort);
    if (data.view && data.view !== 'list') params.set('view', data.view);
    if (data.layout && data.layout !== 'split') params.set('layout', data.layout);
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

  $: hasActiveFilters = (data.q || data.sinceDays || (data.selectedScores?.length ?? 0) < 6 || data.readFilter !== 'all' || (data.selectedReactions?.length ?? 0) < 3 || (data.selectedTagIds?.length ?? 0) > 0);
  $: activeFilterCount = [
    data.q ? 1 : 0,
    data.sinceDays ? 1 : 0,
    (data.selectedScores?.length ?? 6) < 6 ? 1 : 0,
    data.readFilter && data.readFilter !== 'all' ? 1 : 0,
    (data.selectedReactions?.length ?? 3) < 3 ? 1 : 0,
    (data.selectedTagIds?.length ?? 0) > 0 ? 1 : 0
  ].reduce((a, b) => a + b, 0);
</script>

<div role="status" aria-live="polite" class="sr-only">{statusMessage}</div>

<div class="articles-page">
  <section class="articles-hero" aria-labelledby="articles-heading">
    <div class="hero-copy">
      <p class="hero-kicker">Reading Stream</p>
      <h1 id="articles-heading">Articles</h1>
      <p class="hero-description">
        Scan the strongest stories, keep filters tucked away until you need them, and open straight into the full reading view.
      </p>
    </div>

    <div class="hero-side">
      <div class="hero-stats">
        <span class="stat-pill">{data.pagination?.total ?? 0} articles</span>
        {#if sinceDays}
          <span class="stat-pill">Last {sinceDays} days</span>
        {/if}
        {#if readFilter === 'unread'}
          <span class="stat-pill">Unread only</span>
        {/if}
        {#if activeFilterCount > 0}
          <span class="stat-pill active">{activeFilterCount} filters active</span>
        {/if}
      </div>

      <div class="hero-actions">
        <button class="filter-toggle" type="button" on:click={() => (filtersOpen = !filtersOpen)} aria-expanded={filtersOpen}>
          <IconAdjustments size={16} stroke={1.9} />
          <span>Refine stream</span>
          {#if activeFilterCount > 0}
            <span class="filter-badge">{activeFilterCount}</span>
          {/if}
          <span class="toggle-arrow" class:open={filtersOpen}>▾</span>
        </button>

        {#if hasActiveFilters}
          <a class="clear-all" href="/articles" data-sveltekit-reload="true">
            <IconFilterX size={14} stroke={1.9} />
            <span>Clear all</span>
          </a>
        {/if}
      </div>
    </div>
  </section>

  {#if filtersOpen}
    <ArticleFilters
      bind:query
      bind:selectedScores
      bind:readFilter
      bind:sort
      bind:view
      bind:cardLayout
      bind:selectedReactions
      bind:selectedTagIds
      availableTags={data.availableTags ?? []}
      clearHref="/articles"
      {sinceDays}
    />
  {/if}

  <div class="stream-meta">
    <p>
      {view === 'grouped' ? 'Grouped by publish date for scanning bursts.' : 'Continuous stream for uninterrupted reading.'}
    </p>
    <p>{cardLayout === 'stacked' ? 'Stacked cards' : 'Split cards'} · {sort.replace('_', ' ')}</p>
  </div>

  <Pagination
    pagination={data.pagination}
    hrefBuilder={pageHref}
  />

  <section class="articles-stream" aria-label="Articles">
    {#if visibleArticles.length === 0}
      <div class="empty-state">
        <p>Nothing matches this filter set yet.</p>
        <span>Widen the stream or pull in newer articles.</span>
        {#if hasActiveFilters}
          <a href="/articles" data-sveltekit-reload="true">Clear all filters</a>
        {/if}
      </div>
    {:else}
      {#each visibleArticles as article, index (article.id)}
        {@const pending = Boolean(pendingById[article.id])}
        {#if view === 'grouped'}
          {@const currentDateKey = publishDateKey(article)}
          {@const previousDateKey = index > 0 ? publishDateKey(visibleArticles[index - 1]) : null}
          {#if currentDateKey !== previousDateKey}
            <div class="date-heading" role="presentation">
              <span></span>
              <h2>{publishDateLabel(article)}</h2>
              <span></span>
            </div>
          {/if}
        {/if}

        <ArticleCard
          {article}
          cardLayout={cardLayout}
          {pending}
          imageFailed={imageFailed(article.id)}
          href={articleHref(article.id)}
          on:react={(event) =>
            reactToArticle(event.detail.articleId, event.detail.value, event.detail.feedId)}
          on:toggleRead={(event) => setReadState(event.detail.articleId, event.detail.isRead)}
          on:imageError={(event) => markImageError(event.detail.articleId)}
          on:acceptSuggestion={(event) =>
            acceptTagSuggestion(event.detail.articleId, event.detail.suggestion)}
          on:dismissSuggestion={(event) =>
            dismissTagSuggestion(event.detail.articleId, event.detail.suggestion)}
        />
      {/each}
    {/if}
  </section>

  <Pagination
    pagination={data.pagination}
    hrefBuilder={pageHref}
  />
</div>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .articles-page {
    min-width: 0;
    display: grid;
    gap: clamp(1.1rem, 2vw, 1.75rem);
    overflow-x: clip;
  }

  .articles-hero,
  .hero-copy,
  .hero-side,
  .hero-stats,
  .hero-actions,
  .stream-meta,
  .articles-stream,
  .date-heading {
    min-width: 0;
  }

  .articles-hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: clamp(1rem, 2vw, 2rem);
    flex-wrap: wrap;
    padding: clamp(1.05rem, 1.9vw, 1.55rem);
    border-radius: clamp(1.2rem, 2vw, 1.75rem);
    border: 1px solid color-mix(in srgb, var(--surface-border) 115%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--surface-strong) 90%, transparent), color-mix(in srgb, var(--surface) 90%, transparent)),
      radial-gradient(circle at top left, color-mix(in srgb, var(--primary-soft) 88%, transparent), transparent 44%),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nebula-b) 48%, transparent), transparent 42%);
    box-shadow: 0 18px 40px color-mix(in srgb, var(--shadow-color) 28%, transparent);
    overflow: clip;
  }

  .hero-copy {
    max-width: 40rem;
    display: grid;
    gap: 0.4rem;
  }

  .hero-kicker {
    margin: 0;
    color: var(--muted-text);
    font-size: var(--text-xs);
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .hero-copy h1,
  .hero-description,
  .stream-meta p,
  .empty-state p,
  .empty-state span {
    margin: 0;
  }

  .hero-copy h1 {
    font-size: clamp(2rem, 3.1vw, 3.5rem);
    line-height: 1.02;
    letter-spacing: -0.03em;
  }

  .hero-description {
    color: color-mix(in srgb, var(--text-color) 82%, var(--muted-text));
    font-size: clamp(1rem, 1.2vw, 1.08rem);
    line-height: 1.65;
    max-width: 34rem;
    overflow-wrap: anywhere;
  }

  .hero-side {
    display: grid;
    gap: var(--space-3);
    justify-items: end;
    align-content: start;
  }

  .hero-stats,
  .hero-actions {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .stat-pill,
  .filter-toggle,
  .clear-all {
    min-height: 42px;
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .stat-pill {
    padding: 0.55rem 0.85rem;
    background: color-mix(in srgb, var(--surface-soft) 88%, transparent);
    border: 1px solid color-mix(in srgb, var(--surface-border) 112%, transparent);
    color: var(--text-color);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .stat-pill.active {
    background: linear-gradient(90deg, color-mix(in srgb, var(--primary-soft) 84%, transparent), color-mix(in srgb, var(--surface-soft) 86%, transparent));
  }

  .filter-toggle,
  .clear-all {
    padding: 0.7rem 1rem;
    font: inherit;
    text-decoration: none;
    cursor: pointer;
    transition:
      transform var(--transition-fast),
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast);
  }

  .filter-toggle {
    border: 1px solid color-mix(in srgb, var(--surface-border) 116%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 86%, transparent);
    color: var(--text-color);
  }

  .clear-all {
    border: 1px solid color-mix(in srgb, var(--surface-border) 112%, transparent);
    background: transparent;
    color: var(--muted-text);
  }

  .filter-toggle:hover,
  .clear-all:hover {
    transform: translateY(-1px);
  }

  .filter-badge {
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.35rem;
    border-radius: var(--radius-full);
    background: var(--primary);
    color: var(--button-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .toggle-arrow {
    color: var(--muted-text);
    transition: transform var(--transition-fast);
  }

  .toggle-arrow.open {
    transform: rotate(180deg);
  }

  .stream-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .articles-stream {
    display: grid;
    gap: clamp(1rem, 1.5vw, 1.4rem);
  }

  .date-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .date-heading span {
    height: 1px;
    background: color-mix(in srgb, var(--surface-border) 108%, transparent);
  }

  .date-heading h2 {
    margin: 0;
    color: var(--muted-text);
    font-size: var(--text-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }

  .empty-state {
    display: grid;
    gap: 0.45rem;
    padding: clamp(1.1rem, 1.8vw, 1.5rem);
    border-radius: clamp(1.1rem, 1.8vw, 1.45rem);
    border: 1px dashed color-mix(in srgb, var(--surface-border) 120%, transparent);
    background: color-mix(in srgb, var(--surface-strong) 52%, transparent);
  }

  .empty-state span,
  .empty-state a {
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  @media (max-width: 760px) {
    .hero-side {
      width: 100%;
      justify-items: stretch;
    }

    .hero-stats,
    .hero-actions {
      justify-content: flex-start;
    }

    .filter-toggle,
    .clear-all {
      flex: 1 1 12rem;
      justify-content: center;
    }
  }
</style>
