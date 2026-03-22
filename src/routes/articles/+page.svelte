<script>
  import { goto, invalidateAll } from '$app/navigation';
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
  import { getFitScoreAria, getFitScoreText, getFitScoreTone, getScoreToken } from '$lib/fit-score';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import ReactionReasonDialog from '$lib/components/articles/ReactionReasonDialog.svelte';
  import { showToast } from '$lib/client/toast';
  export let data;

  const TOAST_TIMEOUT_MS = 4000;
  const DEFAULT_SCORE_FILTER = ['5', '4', '3', '2', '1', 'learning', 'unscored'];
  const DEFAULT_REACTION_FILTER = ['up', 'down', 'none'];

  const toInt = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };
  const normalizeReadValue = (value) => (toInt(value, 0) === 1 ? 1 : 0);
  const reactionNumber = (value) => { const n = Number(value); if (n === 1) return 1; if (n === -1) return -1; return null; };
  const normalizeArticle = (article) => ({
    ...article,
    is_read: normalizeReadValue(article?.is_read),
    reaction_value: reactionNumber(article?.reaction_value),
    reaction_reason_codes: Array.isArray(article?.reaction_reason_codes) ? article.reaction_reason_codes : [],
    score_status:
      article?.score_status === 'insufficient_signal' || article?.score_status === 'ready'
        ? article.score_status
        : null,
    score_confidence: Number.isFinite(Number(article?.score_confidence)) ? Number(article.score_confidence) : null,
    score_preference_confidence: Number.isFinite(Number(article?.score_preference_confidence))
      ? Number(article.score_preference_confidence)
      : null,
    tags: Array.isArray(article?.tags) ? article.tags : [],
    tag_suggestions: Array.isArray(article?.tag_suggestions) ? article.tag_suggestions : []
  });

  let query = data.q ?? '';
  let selectedScores = [...(data.selectedScores ?? DEFAULT_SCORE_FILTER)];
  let readFilter = data.readFilter ?? 'unread';
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
  let uiMessageTimer = null;
  let lastDataSyncKey = '';
  let lastServerArticlesKey = '';
  let filtersOpen = false;
  let statusMessage = '';
  let reactionDialogOpen = false;
  let reactionDialogArticleId = null;
  let reactionDialogValue = 1;
  let reactionDialogReasonCodes = [];

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
  const articleHasSelectedTags = (article) => { if (selectedTagIds.length === 0) return true; const tagIds = new Set((article.tags ?? []).map((t) => String(t?.id ?? t))); return selectedTagIds.every((id) => tagIds.has(String(id))); };
  const reactionFilterValue = (rv) => { const n = reactionNumber(rv); if (n === 1) return 'up'; if (n === -1) return 'down'; return 'none'; };
  const matchesClientFilters = (article) => {
    if (!selectedScores.includes(getScoreToken(article.score, article.score_status))) return false;
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

  const reactToArticle = async (articleId, value, feedId, reasonCodes = []) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    const previous = reactionNumber(current.reaction_value);
    const previousReasonCodes = Array.isArray(current.reaction_reason_codes)
      ? [...current.reaction_reason_codes]
      : [];
    setOptimisticPatch(articleId, {
      reaction_value: value,
      reaction_reason_codes: [...reasonCodes]
    });
    setPending(articleId, true);
    try {
      const res = await apiFetch(`/api/articles/${articleId}/reaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value, feedId, reasonCodes })
      });
      if (!res.ok) throw new Error('reaction_failed');
      const payload = await res.json().catch(() => ({}));
      const savedReaction = payload?.data?.reaction ?? payload?.reaction ?? null;
      setOptimisticPatch(articleId, {
        reaction_value: reactionNumber(savedReaction?.value ?? value),
        reaction_reason_codes: Array.isArray(savedReaction?.reason_codes)
          ? savedReaction.reason_codes
          : [...reasonCodes]
      });
      void refreshInBackground();
    } catch {
      setOptimisticPatch(articleId, {
        reaction_value: previous,
        reaction_reason_codes: previousReasonCodes
      });
      clearOptimisticFields(articleId, ['reaction_value', 'reaction_reason_codes']);
      statusMessage = 'Unable to save feed reaction. Reverted.';
      showToast('Unable to save feed reaction. Reverted.', 'error');
    } finally {
      setPending(articleId, false);
    }
  };

  const openReactionDialog = (articleId, value) => {
    if (isPending(articleId)) return;
    const current = findMergedArticle(articleId);
    if (!current) return;
    reactionDialogArticleId = articleId;
    reactionDialogValue = value;
    reactionDialogReasonCodes =
      reactionNumber(current.reaction_value) === value &&
      Array.isArray(current.reaction_reason_codes)
        ? [...current.reaction_reason_codes]
        : [];
    reactionDialogOpen = true;
  };

  const closeReactionDialog = () => {
    reactionDialogOpen = false;
    reactionDialogArticleId = null;
    reactionDialogReasonCodes = [];
  };

  const submitReactionDialog = (reasonCodes) => {
    if (!reactionDialogArticleId) {
      closeReactionDialog();
      return;
    }
    const article = findMergedArticle(reactionDialogArticleId);
    const articleId = reactionDialogArticleId;
    const feedId = article?.source_feed_id ?? null;
    void reactToArticle(articleId, reactionDialogValue, feedId, reasonCodes);
    closeReactionDialog();
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
    if (data.readFilter && data.readFilter !== 'unread') params.set('read', data.readFilter);
    if (data.sinceDays) params.set('sinceDays', String(data.sinceDays));
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

  const filterHref = (overrides = {}) => {
    const params = new URLSearchParams();
    const r = overrides.read ?? data.readFilter ?? 'unread';
    const s = overrides.sort ?? data.sort ?? 'newest';
    const sc = overrides.scores ?? data.selectedScores ?? DEFAULT_SCORE_FILTER;
    if (r !== 'unread') params.set('read', r);
    if (s !== 'newest') params.set('sort', s);
    for (const score of sc) params.append('score', score);
    if (data.q) params.set('q', data.q);
    if (data.sinceDays) params.set('sinceDays', String(data.sinceDays));
    if (data.view && data.view !== 'list') params.set('view', data.view);
    for (const reaction of data.selectedReactions ?? []) params.append('reaction', reaction);
    for (const tagId of data.selectedTagIds ?? []) params.append('tags', tagId);
    const qs = params.toString();
    return `/articles${qs ? '?' + qs : ''}`;
  };

  const scoreThresholdToFilter = (scores) => {
    if (!scores || scores.length >= 7) return 'any';
    const nums = scores.filter(s => !isNaN(Number(s))).map(Number).sort();
    if (nums.length === 3 && nums[0] === 3 && nums[1] === 4 && nums[2] === 5) return '3plus';
    if (nums.length === 2 && nums[0] === 4 && nums[1] === 5) return '4plus';
    if (nums.length === 1 && nums[0] === 5) return '5only';
    return 'custom';
  };

  const scoreFilterToScores = (val) => {
    if (val === '3plus') return ['5', '4', '3'];
    if (val === '4plus') return ['5', '4'];
    if (val === '5only') return ['5'];
    return [...DEFAULT_SCORE_FILTER];
  };

  $: currentScoreFilter = scoreThresholdToFilter(data.selectedScores);

  $: advancedFilterCount = [
    data.q ? 1 : 0,
    (data.selectedReactions?.length ?? 3) < 3 ? 1 : 0,
    (data.selectedTagIds?.length ?? 0) > 0 ? 1 : 0,
    data.view && data.view !== 'list' ? 1 : 0
  ].reduce((a, b) => a + b, 0);

  $: hasActiveFilters = (data.q || data.sinceDays || (data.selectedScores?.length ?? 0) < 7 || data.readFilter !== 'unread' || (data.selectedReactions?.length ?? 0) < 3 || (data.selectedTagIds?.length ?? 0) > 0);
  $: activeFilterCount = [
    data.q ? 1 : 0,
    data.sinceDays ? 1 : 0,
    (data.selectedScores?.length ?? 7) < 7 ? 1 : 0,
    data.readFilter && data.readFilter !== 'unread' ? 1 : 0,
    (data.selectedReactions?.length ?? 3) < 3 ? 1 : 0,
    (data.selectedTagIds?.length ?? 0) > 0 ? 1 : 0
  ].reduce((a, b) => a + b, 0);
</script>

<div role="status" aria-live="polite" class="sr-only">{statusMessage}</div>

<PageHeader title="Articles" description="Review summaries and tune the relevance score.">
  <svelte:fragment slot="actions">
    <div class="header-actions">
      {#if data.sinceDays}
        <span class="article-count">Last {data.sinceDays} days</span>
      {/if}
      <span class="article-count">{data.pagination?.total ?? 0} articles</span>
    </div>
  </svelte:fragment>
</PageHeader>

<!-- Inline filter bar -->
<div class="filter-bar">
  <div class="pill-group">
    <a class="pill" class:active={readFilter === 'all'} href={filterHref({ read: 'all' })}>All</a>
    <a class="pill" class:active={readFilter === 'unread'} href={filterHref({ read: 'unread' })}>Unread</a>
    <a class="pill" class:active={readFilter === 'read'} href={filterHref({ read: 'read' })}>Read</a>
  </div>

  <select class="inline-select" value={sort} on:change={(e) => goto(filterHref({ sort: e.currentTarget.value }))}>
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="score_desc">Best fit</option>
    <option value="unread_first">Unread first</option>
  </select>

  <select class="inline-select" value={currentScoreFilter} on:change={(e) => goto(filterHref({ scores: scoreFilterToScores(e.currentTarget.value) }))}>
    <option value="any">Any score</option>
    <option value="3plus">3+</option>
    <option value="4plus">4+</option>
    <option value="5only">5 only</option>
    {#if currentScoreFilter === 'custom'}<option value="custom">Custom</option>{/if}
  </select>

  <button class="filter-toggle" on:click={() => (filtersOpen = !filtersOpen)} aria-expanded={filtersOpen}>
    <IconAdjustments size={14} stroke={1.9} />
    <span>More</span>
    {#if advancedFilterCount > 0}
      <span class="filter-badge">{advancedFilterCount}</span>
    {/if}
  </button>

  {#if hasActiveFilters}
    <a class="clear-link" href="/articles" data-sveltekit-reload="true">Clear</a>
  {/if}
</div>

{#if filtersOpen}
  <form class="filters-panel" method="get">
    {#if sinceDays}
      <input type="hidden" name="sinceDays" value={sinceDays} />
    {/if}
    <input type="hidden" name="read" value={readFilter} />
    <input type="hidden" name="sort" value={sort} />
    {#each selectedScores as sc}<input type="hidden" name="score" value={sc} />{/each}
    <div class="filter-row">
      <div class="filter-group">
        <label class="filter-label" for="q-input">Search</label>
        <div class="search-row">
          <input id="q-input" name="q" placeholder="Search headlines and summaries" bind:value={query} />
          <Button type="submit" size="icon" title="Search">
            <IconSearch size={15} stroke={1.9} />
          </Button>
        </div>
      </div>

      <div class="filter-group">
        <span class="filter-label">View</span>
        <div class="radio-row">
          <label class="radio-opt"><input type="radio" name="view" value="list" bind:group={view} /><span>List</span></label>
          <label class="radio-opt"><input type="radio" name="view" value="grouped" bind:group={view} /><span>By date</span></label>
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
          <span>Apply</span>
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
      <article class="card layout-{cardLayout}" class:read={isArticleRead(article)} id="article-{article.id}">
        <div
          class="accent-bar {getFitScoreTone(article.score, article.score_status)}"
          class:read={isArticleRead(article)}
          aria-hidden="true"
        ></div>
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
                class={`fit-pill ${getFitScoreTone(article.score, article.score_status)}`}
                title={getFitScoreAria(article.score, article.score_status)}
                aria-label={getFitScoreAria(article.score, article.score_status)}
              >
                <IconStars size={13} stroke={1.9} />
                <span>{getFitScoreText(article.score, article.score_status)}</span>
              </span>
              <Pill variant={isArticleRead(article) ? 'muted' : 'default'}>
                {isArticleRead(article) ? 'Read' : 'Unread'}
              </Pill>
            </div>
          </div>
          <div class="card-meta">
            <span>{article.source_name ?? 'Unknown source'}{#if article.source_feedback_count} · rep {article.source_reputation.toFixed(2)}{/if} · {article.published_at ? new Date(article.published_at).toLocaleString() : ''}</span>
            <div class="card-actions-inline" class:pending={pending}>
              <button
                type="button"
                class="icon-btn-sm"
                class:active={reactionNumber(article.reaction_value) === 1}
                on:click={() => openReactionDialog(article.id, 1)}
                title="Thumbs up feed"
                aria-label="Thumbs up feed"
                disabled={pending}
              >
                <IconThumbUp size={13} stroke={1.9} />
              </button>
              <button
                type="button"
                class="icon-btn-sm"
                class:active={reactionNumber(article.reaction_value) === -1}
                on:click={() => openReactionDialog(article.id, -1)}
                title="Thumbs down feed"
                aria-label="Thumbs down feed"
                disabled={pending}
              >
                <IconThumbDown size={13} stroke={1.9} />
              </button>
              <button
                type="button"
                class="icon-btn-sm"
                on:click={() => setReadState(article.id, !isArticleRead(article))}
                title={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
                aria-label={isArticleRead(article) ? 'Mark unread' : 'Mark read'}
                disabled={pending}
              >
                {#if isArticleRead(article)}
                  <IconEyeOff size={13} stroke={1.9} />
                {:else}
                  <IconEye size={13} stroke={1.9} />
                {/if}
              </button>
            </div>
          </div>
          {#if article.author}
            <div class="byline">By {article.author}</div>
          {/if}
          {#if article.tags?.length}
            <div class="tag-row">
              {#each article.tags.slice(0, 3) as tag}
                <span class="tag-chip">{tag.name}</span>
              {/each}
              {#if article.tags.length > 3}
                <span class="tag-chip muted">+{article.tags.length - 3}</span>
              {/if}
            </div>
          {/if}
          <p class="excerpt">{article.summary_text ?? article.excerpt ?? ''}</p>
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

<ReactionReasonDialog
  open={reactionDialogOpen}
  value={reactionDialogValue}
  initialReasonCodes={reactionDialogReasonCodes}
  on:close={closeReactionDialog}
  on:save={(event) => submitReactionDialog(event.detail.reasonCodes ?? [])}
  on:skip={() => submitReactionDialog([])}
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
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }

  .pill-group {
    display: inline-flex;
    border: 1px solid var(--input-border);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .pill {
    padding: 0.35rem 0.75rem;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--muted-text);
    text-decoration: none;
    transition: background var(--transition-fast), color var(--transition-fast);
    border-right: 1px solid var(--input-border);
  }

  .pill:last-child {
    border-right: none;
  }

  .pill:hover {
    background: var(--surface-soft);
  }

  .pill.active {
    background: var(--primary);
    color: var(--button-text);
  }

  .inline-select {
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--surface-strong);
    font-size: var(--text-sm);
    font-family: inherit;
    color: var(--text-color);
    cursor: pointer;
  }

  .filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface-strong);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-md);
    padding: 0.35rem 0.7rem;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    color: var(--text-color);
  }

  .filter-toggle:hover {
    background: var(--primary-soft);
  }

  .filter-badge {
    background: var(--primary);
    color: var(--button-text);
    border-radius: var(--radius-full);
    padding: 0 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .clear-link {
    font-size: var(--text-sm);
    color: var(--muted-text);
    text-decoration: none;
    font-weight: 500;
  }

  .clear-link:hover {
    color: var(--text-color);
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
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    margin-bottom: var(--space-5);
    display: grid;
    gap: var(--space-5);
    backdrop-filter: blur(var(--blur-md));
    -webkit-backdrop-filter: blur(var(--blur-md));
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
    font-weight: 600;
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
    border-radius: var(--radius-sm);
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
    border-radius: var(--radius-sm);
    background: var(--surface-soft);
  }

  .radio-opt input { accent-color: var(--primary); margin: 0; }

  .select-all-btn {
    background: var(--surface-soft);
    border: none;
    color: var(--ghost-color);
    border-radius: var(--radius-sm);
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
    box-shadow: none;
    border: 1px solid var(--surface-border);
    display: grid;
    gap: var(--space-3);
    align-items: start;
    transition: box-shadow var(--transition-normal), transform var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast);
    overflow: hidden;
  }

  .card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
    border-color: var(--surface-border-hover);
  }

  .card.read {
    opacity: 0.65;
  }
  .card.read:hover {
    opacity: 1;
  }

  .accent-bar {
    grid-area: bar;
    width: 4px;
    border-radius: 2px;
    align-self: stretch;
  }

  .accent-bar.read { opacity: 0.3; }
  .accent-bar.fit-1 { background: #fca5a5; }
  .accent-bar.fit-2 { background: #fdba74; }
  .accent-bar.fit-3 { background: #c4b5fd; }
  .accent-bar.fit-4 { background: #67e8f9; }
  .accent-bar.fit-5 { background: #86efac; }
  .accent-bar.fit-none,
  .accent-bar.fit-learning { background: var(--muted-text); opacity: 0.2; }

  .card.layout-split {
    grid-template-columns: 4px 140px minmax(0, 1fr);
    grid-template-rows: 1fr;
    grid-template-areas: 'bar image main';
  }

  .card.layout-stacked {
    grid-template-columns: 4px 1fr;
    grid-template-areas:
      'bar image'
      'bar main';
    padding: 0;
  }

  .card.layout-stacked .card-main {
    padding: var(--space-3);
  }

  .card.layout-split {
    padding: 0;
  }

  .card.layout-split .card-main {
    padding: var(--space-3);
  }

  .card-img-link {
    grid-area: image;
    display: block;
    background: linear-gradient(145deg, rgba(83, 118, 255, 0.20), rgba(124, 106, 239, 0.14), rgba(200, 120, 80, 0.10));
  }

  .card.layout-split .card-img-link {
    height: 100%;
  }

  .card.layout-stacked .card-img-link {
    height: 160px;
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
    background: linear-gradient(145deg, rgba(83, 118, 255, 0.20), rgba(124, 106, 239, 0.14), rgba(200, 120, 80, 0.10));
  }

  .card-main {
    grid-area: main;
    display: grid;
    gap: 0.5rem;
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
    font-size: 0.95rem;
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
    border-radius: var(--radius-sm);
    background: var(--surface-soft);
    color: var(--muted-text);
    padding: 0.22rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1;
  }

  .fit-pill.fit-none,
  .fit-pill.fit-learning {
    color: var(--muted-text);
    background: var(--surface-soft);
  }

  .fit-pill.fit-1 {
    color: #e8a0a0;
    background: rgba(232, 160, 160, 0.10);
  }

  .fit-pill.fit-2 {
    color: #e0b080;
    background: rgba(224, 176, 128, 0.10);
  }

  .fit-pill.fit-3 {
    color: #b8aae8;
    background: rgba(184, 170, 232, 0.10);
  }

  .fit-pill.fit-4 {
    color: #70d0e0;
    background: rgba(112, 208, 224, 0.10);
  }

  .fit-pill.fit-5 {
    color: #7aded0;
    background: rgba(122, 222, 208, 0.10);
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
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    padding: 0.15rem 0.5rem;
    font-size: 0.7rem;
    color: var(--muted-text);
  }

  .tag-chip.muted {
    color: var(--muted-text);
    border-color: transparent;
  }

  .excerpt {
    margin: 0;
    color: var(--muted-text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .card-actions-inline {
    display: inline-flex;
    gap: 0.3rem;
    align-items: center;
    margin-left: auto;
  }

  .card-actions-inline.pending { opacity: 0.85; }

  .icon-btn-sm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    color: var(--text-color);
    cursor: pointer;
    padding: 0;
  }

  .icon-btn-sm:hover {
    background: var(--primary-soft);
  }

  .icon-btn-sm.active {
    background: var(--primary-soft);
    color: var(--primary);
    border-color: var(--primary);
  }

  .icon-btn-sm:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  /* Date grouping */
  .date-heading {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-text);
    padding-bottom: var(--space-2);
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
      grid-template-columns: 4px 1fr;
      grid-template-areas:
        'bar image'
        'bar main';
    }

    .card.layout-split .card-img-link {
      height: 140px;
    }

    .card.layout-split .card-main {
      padding: var(--space-3) var(--space-3) var(--space-3);
    }
  }
</style>
