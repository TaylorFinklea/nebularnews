<script>
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import {
    IconAdjustments,
    IconEye,
    IconEyeOff,
    IconFilterX,
    IconPlus,
    IconSearch,
    IconStars,
    IconThumbDown,
    IconThumbUp,
    IconX
  } from '$lib/icons';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import { showToast } from '$lib/client/toast';
  export let data;

  const TOAST_TIMEOUT_MS = 4000;
  const DEFAULT_SCORE_FILTER = ['5', '4', '3', '2', '1', 'unscored'];
  const DEFAULT_REACTION_FILTER = ['up', 'down', 'none'];

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
  let uiMessageTimer = null;
  let lastDataSyncKey = '';
  let lastServerArticlesKey = '';
  let filtersOpen = false;
  let statusMessage = '';

  const syncFilterStateFromData = () => {
    const nextState = { q: data.q ?? '', selectedScores: data.selectedScores ?? DEFAULT_SCORE_FILTER, readFilter: data.readFilter ?? 'all', sort: data.sort ?? 'newest', view: data.view ?? 'list', layout: data.layout ?? 'split', selectedReactions: data.selectedReactions ?? DEFAULT_REACTION_FILTER, selectedTagIds: data.selectedTagIds ?? [] };
    const nextKey = JSON.stringify(nextState);
    if (nextKey === lastDataSyncKey) return;
    lastDataSyncKey = nextKey;
    query = nextState.q; selectedScores = [...nextState.selectedScores]; readFilter = nextState.readFilter;
    sort = nextState.sort; view = nextState.view; cardLayout = nextState.layout;
    selectedReactions = [...nextState.selectedReactions]; selectedTagIds = [...nextState.selectedTagIds];
  };

  $: syncFilterStateFromData();

  onDestroy(() => { if (uiMessageTimer) clearTimeout(uiMessageTimer); });

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

  $: hasActiveFilters = (data.q || (data.selectedScores?.length ?? 0) < 6 || data.readFilter !== 'all' || (data.selectedReactions?.length ?? 0) < 3 || (data.selectedTagIds?.length ?? 0) > 0);
  $: activeFilterCount = [
    data.q ? 1 : 0,
    (data.selectedScores?.length ?? 6) < 6 ? 1 : 0,
    data.readFilter && data.readFilter !== 'all' ? 1 : 0,
    (data.selectedReactions?.length ?? 3) < 3 ? 1 : 0,
    (data.selectedTagIds?.length ?? 0) > 0 ? 1 : 0
  ].reduce((a, b) => a + b, 0);
</script>

<div role="status" aria-live="polite" class="sr-only">{statusMessage}</div>

<PageHeader title="Articles" description="Review summaries and tune the relevance score.">
  <svelte:fragment slot="actions">
    <div class="header-actions">
      <span class="article-count">{data.pagination?.total ?? 0} articles</span>
    </div>
  </svelte:fragment>
</PageHeader>

<!-- Collapsible filters -->
<div class="filter-bar">
  <button class="filter-toggle" on:click={() => (filtersOpen = !filtersOpen)} aria-expanded={filtersOpen}>
    <IconAdjustments size={16} stroke={1.9} />
    <span>Filters</span>
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

{#if filtersOpen}
  <form class="filters-panel" method="get">
    <div class="filter-row">
      <div class="filter-group">
        <label class="filter-label" for="q-input">Search</label>
        <div class="search-row">
          <input id="q-input" name="q" placeholder="Search headlines and summaries" bind:value={query} />
          <Button type="submit" size="icon" title="Apply filters">
            <IconSearch size={15} stroke={1.9} />
          </Button>
        </div>
      </div>

      <div class="filter-group">
        <label class="filter-label" for="sort-select">Sort</label>
        <select id="sort-select" name="sort" bind:value={sort}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score_desc">Score high → low</option>
          <option value="score_asc">Score low → high</option>
          <option value="unread_first">Unread first</option>
          <option value="title_az">Title A–Z</option>
        </select>
      </div>

      <div class="filter-group">
        <label class="filter-label" for="read-select">Read status</label>
        <select id="read-select" name="read" bind:value={readFilter}>
          <option value="all">All articles</option>
          <option value="unread">Unread only</option>
          <option value="read">Read only</option>
        </select>
      </div>

      <div class="filter-group">
        <span class="filter-label">View</span>
        <div class="radio-row">
          <label class="radio-opt"><input type="radio" name="view" value="list" bind:group={view} /><span>List</span></label>
          <label class="radio-opt"><input type="radio" name="view" value="grouped" bind:group={view} /><span>By date</span></label>
        </div>
      </div>
    </div>

    <div class="filter-row">
      <div class="filter-group">
        <span class="filter-label">AI Score</span>
        <div class="check-row">
          {#each [['5','Perfect'], ['4','Strong'], ['3','Okay'], ['2','Weak'], ['1','Poor'], ['unscored','Unscored']] as [val, lbl]}
            <label class="check-opt">
              <input type="checkbox" name="score" value={val} bind:group={selectedScores} />
              <span>{lbl}</span>
            </label>
          {/each}
          <button type="button" class="select-all-btn" on:click={() => (selectedScores = [...DEFAULT_SCORE_FILTER])}>All</button>
        </div>
      </div>

      <div class="filter-group">
        <span class="filter-label">Reactions</span>
        <div class="check-row">
          <label class="check-opt"><input type="checkbox" name="reaction" value="up" bind:group={selectedReactions} /><span>👍 Up</span></label>
          <label class="check-opt"><input type="checkbox" name="reaction" value="none" bind:group={selectedReactions} /><span>— None</span></label>
          <label class="check-opt"><input type="checkbox" name="reaction" value="down" bind:group={selectedReactions} /><span>👎 Down</span></label>
          <button type="button" class="select-all-btn" on:click={() => (selectedReactions = [...DEFAULT_REACTION_FILTER])}>All</button>
        </div>
      </div>

      {#if (data.availableTags ?? []).length > 0}
        <div class="filter-group filter-group-tags">
          <label class="filter-label" for="tags-select">Tags</label>
          <select id="tags-select" name="tags" multiple bind:value={selectedTagIds} size="4">
            {#each data.availableTags ?? [] as tag}
              <option value={tag.id}>{tag.name} ({tag.article_count})</option>
            {/each}
          </select>
        </div>
      {/if}

      <div class="filter-submit">
        <Button type="submit" size="inline">
          <IconSearch size={15} stroke={1.9} />
          <span>Apply filters</span>
        </Button>
      </div>
    </div>
  </form>
{/if}

<!-- Pagination top -->
<Pagination
  pagination={data.pagination}
  hrefBuilder={pageHref}
/>

<!-- Articles list -->
<div class="articles">
  {#if visibleArticles.length === 0}
    <div class="empty-state">
      <p>No articles yet. Add feeds to start pulling stories.</p>
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
          <h2 class="date-heading">{publishDateLabel(article)}</h2>
        {/if}
      {/if}
      <article class="card layout-{cardLayout}" id="article-{article.id}">
        <a
          class="card-img-link"
          href={articleHref(article.id)}
          tabindex="-1"
          aria-hidden="true"
          data-sveltekit-reload="true"
        >
          {#if imageFailed(article.id)}
            <div class="img-fallback"></div>
          {:else}
            <img
              class="card-img"
              src={resolveArticleImageUrl(article)}
              alt=""
              loading="lazy"
              decoding="async"
              on:error={() => markImageError(article.id)}
            />
          {/if}
        </a>
        <div class="card-main">
          <div class="card-head">
            <h3>
              <a class="title-link" href={articleHref(article.id)} data-sveltekit-reload="true">
                {article.title ?? 'Untitled article'}
              </a>
            </h3>
            <div class="pills">
              <span
                class={`fit-pill ${fitScoreTone(article.score)}`}
                title={fitScoreAria(article.score)}
                aria-label={fitScoreAria(article.score)}
              >
                <IconStars size={13} stroke={1.9} />
                <span>{fitScoreText(article.score)}</span>
              </span>
              <Pill variant={isArticleRead(article) ? 'muted' : 'default'}>
                {isArticleRead(article) ? 'Read' : 'Unread'}
              </Pill>
            </div>
          </div>
          <div class="card-meta">
            <span>{article.source_name ?? 'Unknown source'}{#if article.source_feedback_count} · rep {article.source_reputation.toFixed(2)}{/if}</span>
            <span>{article.published_at ? new Date(article.published_at).toLocaleString() : ''}</span>
          </div>
          {#if article.author}
            <div class="byline">By {article.author}</div>
          {/if}
          {#if article.tags?.length}
            <div class="tag-row">
              {#each article.tags as tag}
                <span class="tag-chip">{tag.name}</span>
              {/each}
            </div>
          {/if}
          {#if article.tag_suggestions?.length}
            <div class="tag-suggestion-row">
              {#each article.tag_suggestions as suggestion}
                <span class="tag-suggestion-chip">
                  <span>{suggestion.name}</span>
                  <button
                    type="button"
                    class="suggestion-action"
                    on:click={() => acceptTagSuggestion(article.id, suggestion)}
                    title={`Accept suggested tag ${suggestion.name}`}
                    aria-label={`Accept suggested tag ${suggestion.name}`}
                    disabled={pending}
                  >
                    <IconPlus size={11} stroke={2} />
                  </button>
                  <button
                    type="button"
                    class="suggestion-action"
                    on:click={() => dismissTagSuggestion(article.id, suggestion)}
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
          <p class="excerpt">{article.summary_text ?? article.excerpt ?? ''}</p>
        </div>
        <div class="card-actions" class:pending={pending}>
          <div class="reactions">
            <button
              type="button"
              class="reaction-btn"
              class:active={reactionNumber(article.reaction_value) === 1}
              on:click={() => reactToArticle(article.id, 1, article.source_feed_id)}
              title="Thumbs up feed"
              aria-label="Thumbs up feed"
              disabled={pending}
            >
              <IconThumbUp size={15} stroke={1.9} />
            </button>
            <button
              type="button"
              class="reaction-btn"
              class:active={reactionNumber(article.reaction_value) === -1}
              on:click={() => reactToArticle(article.id, -1, article.source_feed_id)}
              title="Thumbs down feed"
              aria-label="Thumbs down feed"
              disabled={pending}
            >
              <IconThumbDown size={15} stroke={1.9} />
            </button>
          </div>
          <button
            type="button"
            class="read-btn"
            on:click={() => setReadState(article.id, !isArticleRead(article))}
            title={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
            aria-label={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
            disabled={pending}
          >
            {#if isArticleRead(article)}
              <IconEyeOff size={15} stroke={1.9} />
            {:else}
              <IconEye size={15} stroke={1.9} />
            {/if}
          </button>
        </div>
      </article>
    {/each}
  {/if}
</div>

<!-- Pagination bottom -->
<Pagination
  pagination={data.pagination}
  hrefBuilder={pageHref}
/>

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

  /* Filter bar */
  .filter-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    padding: 0.45rem 0.9rem;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    color: var(--text-color);
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .filter-toggle:hover {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
  }

  .filter-badge {
    background: var(--primary);
    color: var(--button-text);
    border-radius: var(--radius-full);
    padding: 0 0.45rem;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1.6;
  }

  .toggle-arrow {
    transition: transform var(--transition-fast);
    font-size: 0.8rem;
    color: var(--muted-text);
  }

  .toggle-arrow.open {
    transform: rotate(180deg);
  }

  .clear-all {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .article-count {
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  /* Filters panel */
  .filters-panel {
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    margin-bottom: var(--space-5);
    display: grid;
    gap: var(--space-5);
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    align-items: flex-start;
  }

  .filter-group {
    display: grid;
    gap: var(--space-2);
    min-width: 180px;
  }

  .filter-group-tags {
    min-width: 200px;
  }

  .filter-label {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted-text);
  }

  .search-row {
    display: flex;
    gap: var(--space-2);
  }

  .search-row input {
    min-width: 240px;
    flex: 1;
  }

  input:not([type='checkbox']):not([type='radio']),
  select {
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
    font-size: var(--text-sm);
  }

  select[multiple] {
    min-height: 110px;
  }

  .check-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .check-opt {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
  }

  .check-opt input { accent-color: var(--primary); margin: 0; }

  .radio-row {
    display: flex;
    gap: 0.5rem;
  }

  .radio-opt {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
  }

  .radio-opt input { accent-color: var(--primary); margin: 0; }

  .select-all-btn {
    background: transparent;
    border: 1px solid var(--ghost-border);
    color: var(--ghost-color);
    border-radius: var(--radius-full);
    padding: 0.18rem 0.55rem;
    font-size: var(--text-xs);
    cursor: pointer;
    font-family: inherit;
  }

  .filter-submit {
    display: flex;
    align-items: flex-end;
    padding-bottom: 0.05rem;
  }

  /* Articles */
  .articles {
    display: grid;
    gap: var(--space-5);
    margin-bottom: var(--space-5);
  }

  .card {
    background: var(--surface-strong);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-md);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: var(--space-4);
    align-items: start;
    transition: box-shadow var(--transition-fast);
    overflow: hidden;
  }

  .card:hover {
    box-shadow: var(--shadow-lg, 0 20px 40px var(--shadow-color));
  }

  .card.layout-split {
    grid-template-columns: 180px minmax(0, 1fr);
    grid-template-rows: 1fr auto;
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
    padding: 0;
  }

  .card.layout-stacked .card-main {
    padding: var(--space-5);
    padding-bottom: 0;
  }

  .card.layout-stacked .card-actions {
    padding: var(--space-3) var(--space-5);
  }

  .card.layout-split {
    padding: 0;
  }

  .card.layout-split .card-main {
    padding: var(--space-5) var(--space-5) 0 0;
  }

  .card.layout-split .card-actions {
    padding: var(--space-3) var(--space-5);
  }

  .card-img-link {
    grid-area: image;
    display: block;
    background: linear-gradient(145deg, rgba(83, 118, 255, 0.18), rgba(69, 36, 199, 0.1));
  }

  .card.layout-split .card-img-link {
    height: 100%;
  }

  .card.layout-stacked .card-img-link {
    height: 200px;
  }

  .card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .img-fallback {
    width: 100%;
    height: 100%;
    background: linear-gradient(145deg, rgba(83, 118, 255, 0.18), rgba(69, 36, 199, 0.1));
  }

  .card-main {
    grid-area: main;
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    align-content: start;
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.35;
    flex: 1 1 0;
    min-width: 0;
  }

  .title-link {
    color: var(--text-color);
    text-decoration: none;
    transition: color var(--transition-fast);
  }

  .title-link:hover { color: var(--primary); }

  .pills {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .fit-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    color: var(--muted-text);
    padding: 0.26rem 0.58rem;
    font-size: 0.75rem;
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

  .card-meta {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--muted-text);
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .byline {
    font-size: var(--text-xs);
    color: var(--muted-text);
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tag-chip {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    border-radius: var(--radius-full);
    padding: 0.15rem 0.5rem;
    font-size: 0.75rem;
    color: var(--muted-text);
  }

  .tag-suggestion-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tag-suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    border-radius: var(--radius-full);
    border: 1px solid color-mix(in srgb, #4ade80 45%, var(--surface-border));
    background: color-mix(in srgb, #4ade80 18%, transparent);
    padding: 0.12rem 0.3rem 0.12rem 0.52rem;
    font-size: 0.75rem;
    color: var(--text-color);
  }

  .suggestion-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.05rem;
    height: 1.05rem;
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
    padding: 0;
  }

  .suggestion-action:hover:not(:disabled) {
    border-color: var(--surface-border);
    background: color-mix(in srgb, var(--surface-strong) 55%, transparent);
  }

  .suggestion-action:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .excerpt {
    margin: 0;
    color: var(--muted-text);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .card-actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border-top: 1px solid var(--surface-border);
    flex-wrap: wrap;
  }

  .card-actions.pending { opacity: 0.85; }

  .reactions {
    display: inline-flex;
    gap: var(--space-1);
  }

  .reaction-btn, .read-btn {
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    border-radius: var(--radius-full);
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-color);
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .reaction-btn:disabled, .read-btn:disabled { opacity: 0.6; cursor: wait; }

  .reaction-btn.active {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
    color: var(--primary);
  }

  .read-btn {
    border-color: var(--ghost-border);
    color: var(--ghost-color);
    margin-left: auto;
  }

  .read-btn:hover:not(:disabled) { background: var(--primary-soft); }

  /* Date grouping */
  .date-heading {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-text);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--surface-border);
  }

  /* Empty */
  .empty-state {
    padding: var(--space-12) 0;
    text-align: center;
    color: var(--muted-text);
    display: grid;
    gap: var(--space-3);
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

    .card.layout-split .card-img-link {
      height: 160px;
    }

    .card.layout-split .card-main {
      padding: var(--space-4) var(--space-4) 0;
    }

    .card.layout-split .card-actions {
      padding: var(--space-3) var(--space-4);
    }
  }
</style>
