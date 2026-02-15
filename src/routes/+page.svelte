<script>
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { IconClockPlay, IconExternalLink } from '$lib/icons';
  import { resolveArticleImageUrl } from '$lib/article-image';

  export let data;

  const PULL_SESSION_KEY = 'nebular:manual-pull-in-progress';
  const PULL_STATUS_POLL_MS = 1500;
  const PULL_START_GRACE_MS = 15000;
  const PULL_COMPLETION_SKEW_MS = 5000;

  let isPulling = false;
  let pullMessage = '';
  let pullStatusTimer = null;
  let pullStatusSyncInFlight = false;
  let pullTracker = { pending: false, startedAt: null };

  const toFiniteNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const readPullTracker = () => {
    try {
      const raw = sessionStorage.getItem(PULL_SESSION_KEY);
      if (!raw) return { pending: false, startedAt: null };
      if (raw === '1') {
        return { pending: true, startedAt: Date.now() };
      }
      const parsed = JSON.parse(raw);
      return {
        pending: Boolean(parsed?.pending),
        startedAt: toFiniteNumber(parsed?.startedAt)
      };
    } catch {
      return { pending: false, startedAt: null };
    }
  };

  const writePullTracker = (value) => {
    try {
      if (value.pending) {
        sessionStorage.setItem(PULL_SESSION_KEY, JSON.stringify(value));
      } else {
        sessionStorage.removeItem(PULL_SESSION_KEY);
      }
    } catch {
      // Ignore session storage errors.
    }
  };

  const clearPullTracker = () => {
    pullTracker = { pending: false, startedAt: null };
    writePullTracker(pullTracker);
  };

  const completionMatchesTracker = (completedAt, startedAt) => {
    if (completedAt === null) return false;
    if (startedAt === null) return true;
    return completedAt + PULL_COMPLETION_SKEW_MS >= startedAt;
  };

  const syncPullStatus = async () => {
    if (pullStatusSyncInFlight) return;
    pullStatusSyncInFlight = true;
    try {
      const res = await fetch('/api/pull');
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));
      const inProgress = Boolean(payload?.inProgress);
      const startedAt = toFiniteNumber(payload?.startedAt);
      const completedAt = toFiniteNumber(payload?.completedAt);
      const lastRunStatus =
        payload?.lastRunStatus === 'success' || payload?.lastRunStatus === 'failed'
          ? payload.lastRunStatus
          : null;
      const lastError = typeof payload?.lastError === 'string' && payload.lastError.length > 0 ? payload.lastError : null;

      if (inProgress) {
        isPulling = true;
        if (!pullTracker.pending) {
          pullTracker = { pending: true, startedAt: startedAt ?? Date.now() };
        } else if (pullTracker.startedAt === null && startedAt !== null) {
          pullTracker = { ...pullTracker, startedAt };
        }
        writePullTracker(pullTracker);
        return;
      }

      if (!pullTracker.pending) {
        isPulling = false;
        return;
      }

      const completedMatches = completionMatchesTracker(completedAt, pullTracker.startedAt);
      const waitingForStart =
        pullTracker.startedAt !== null && Date.now() - pullTracker.startedAt < PULL_START_GRACE_MS;

      if (!completedMatches && waitingForStart) {
        isPulling = true;
        return;
      }

      isPulling = false;
      clearPullTracker();
      if (completedMatches) {
        pullMessage =
          lastRunStatus === 'failed'
            ? lastError
              ? `Pull failed: ${lastError}`
              : 'Pull failed.'
            : 'Pull complete. Refreshing dashboard...';
        await invalidateAll();
        return;
      }

      pullMessage = 'Pull did not confirm start before timeout. Please try again.';
    } catch {
      // Ignore transient status errors.
    } finally {
      pullStatusSyncInFlight = false;
    }
  };

  onMount(() => {
    pullTracker = readPullTracker();
    if (pullTracker.pending) {
      isPulling = true;
      if (!pullMessage) pullMessage = 'Pulling feeds now...';
    }

    void syncPullStatus();
    pullStatusTimer = setInterval(() => {
      void syncPullStatus();
    }, PULL_STATUS_POLL_MS);
  });

  onDestroy(() => {
    if (pullStatusTimer) {
      clearInterval(pullStatusTimer);
      pullStatusTimer = null;
    }
  });

  const scoreLabel = (score) => {
    if (score >= 5) return 'Perfect fit';
    if (score >= 4) return 'Strong fit';
    return 'Good fit';
  };

  const articleSnippet = (article) => {
    const text = article.summary_text ?? article.excerpt ?? '';
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  };

  const runManualPull = async () => {
    if (isPulling) return;
    isPulling = true;
    pullMessage = '';
    pullTracker = { pending: true, startedAt: Date.now() };
    writePullTracker(pullTracker);
    const cycles = data.isDev ? 3 : 1;
    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycles })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          isPulling = true;
          pullMessage = payload?.error ?? 'Manual pull already in progress';
          void syncPullStatus();
          return;
        }
        pullMessage = payload?.error ?? 'Manual pull failed';
        isPulling = false;
        clearPullTracker();
        return;
      }
      if (payload?.started) {
        isPulling = true;
        pullMessage = 'Pull started. Running in background...';
        void syncPullStatus();
        return;
      }
      pullMessage = `Pull complete (${payload.cycles} cycle${payload.cycles === 1 ? '' : 's'}). Due feeds: ${payload.stats.dueFeeds}, items seen: ${payload.stats.itemsSeen}, items processed: ${payload.stats.itemsProcessed}, articles: ${payload.stats.articles}, pending jobs: ${payload.stats.pendingJobs}, feeds with errors: ${payload.stats.feedsWithErrors}.`;
      if (payload.stats?.recentErrors?.length) {
        const first = payload.stats.recentErrors[0];
        pullMessage += ` First error: ${first.url} -> ${first.message}`;
      }
      isPulling = false;
      clearPullTracker();
      await invalidateAll();
    } catch (error) {
      if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      pullMessage = 'Manual pull failed';
      isPulling = false;
      clearPullTracker();
    }
  };

</script>

<section class="hero">
  <div>
    <h1>Your Nebula at a glance</h1>
    <p>Track the pulse of your feeds, summaries, and personalization queue.</p>
    <div class="dev-tools">
      <button
        class="icon-button"
        class:pulling={isPulling}
        on:click={runManualPull}
        disabled={isPulling}
        title={isPulling ? 'Pulling now' : 'Pull now'}
        aria-label={isPulling ? 'Pulling now' : 'Pull now'}
      >
        <IconClockPlay size={16} stroke={1.9} />
        <span class="sr-only">{isPulling ? 'Pulling now' : 'Pull now'}</span>
      </button>
      <p class="pull-message" role="status" aria-live="polite">
        {#if isPulling}
          Pulling feeds now...
        {:else if pullMessage}
          {pullMessage}
        {/if}
      </p>
    </div>
  </div>
  <div class="stats-wrap">
    <div class="section-head">
      <h3>Today’s Pipeline Coverage</h3>
      <a href="/jobs" class="inline-action">
        <IconExternalLink size={14} stroke={1.9} />
        <span>Jobs</span>
      </a>
    </div>
    <div class="stats">
      <div class="stat">
        <h2>{data.today.articles}</h2>
        <span>Today's articles</span>
      </div>
      <div class="stat">
        <h2>{data.today.summaries}</h2>
        <span>With summary</span>
      </div>
      <div class="stat">
        <h2>{data.today.scores}</h2>
        <span>With AI score</span>
      </div>
      <div class="stat">
        <h2>{data.today.pendingJobs}</h2>
        <span>Pending today jobs</span>
      </div>
      <div class="stat">
        <h2>{data.today.missingSummaries}</h2>
        <span>Missing summaries</span>
      </div>
      <div class="stat">
        <h2>{data.today.missingScores}</h2>
        <span>Missing scores</span>
      </div>
    </div>
  </div>
</section>

<section class="top-rated">
  <div class="section-head">
    <h3>Top Rated Today</h3>
    <a href={data.topRatedConfig?.href ?? '/articles'} class="inline-action">
      <IconExternalLink size={14} stroke={1.9} />
      <span>Full list</span>
    </a>
  </div>
  <p class="muted top-rated-cap">Showing up to {data.topRatedConfig?.limit ?? 5} items.</p>
  {#if data.topRatedArticles.length === 0}
    <p class="muted">No top-rated items yet today. Run a pull or wait for scoring jobs to finish.</p>
  {:else}
    <div class="top-list">
      {#each data.topRatedArticles as article}
        <article class={`top-card layout-${data.topRatedConfig?.layout ?? 'stacked'}`}>
          <a class="top-card-image-link" href={`/articles/${article.id}`}>
            <img
              class="top-card-image"
              src={resolveArticleImageUrl(article)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </a>
          <div class="top-card-head">
            <a class="title" href={`/articles/${article.id}`}>{article.title ?? 'Untitled article'}</a>
            <span class="pill">{article.score}/5 · {scoreLabel(article.score)}</span>
          </div>
          <p class="excerpt">{articleSnippet(article)}</p>
          <div class="meta">
            <span>{article.source_name ?? 'Unknown source'}</span>
            <span>{new Date(article.published_at ?? article.fetched_at).toLocaleString()}</span>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

{#if data.stats.feeds === 0}
  <section class="next-steps">
    <h3>Suggested Next Steps</h3>
    <ul>
      <li>Add your first feed in Settings -> Feeds.</li>
      <li>Run a manual pull to ingest your first articles.</li>
      <li>Set provider keys in Settings -> General to enable summaries and scoring.</li>
    </ul>
  </section>
{/if}

<style>
  .hero {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 2rem;
  }

  .stats-wrap {
    min-width: min(520px, 100%);
  }

  h1 {
    font-family: 'Source Serif 4', serif;
    font-size: 2.4rem;
    margin-bottom: 0.5rem;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(150px, 1fr));
    gap: 1rem;
  }

  .stat {
    background: var(--surface-strong);
    border-radius: 18px;
    padding: 1rem 1.4rem;
    box-shadow: 0 12px 30px var(--shadow-color);
    text-align: center;
    border: 1px solid var(--surface-border);
  }

  .stat h2 {
    margin: 0;
    font-size: 2rem;
    color: var(--primary);
  }

  .next-steps {
    margin-top: 3rem;
    background: var(--surface);
    border-radius: 20px;
    padding: 1.5rem;
    border: 1px solid var(--surface-border);
  }

  .top-rated {
    margin-top: 2.2rem;
    background: var(--surface);
    border-radius: 20px;
    border: 1px solid var(--surface-border);
    padding: 1.4rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .section-head a {
    color: var(--primary);
    font-size: 0.9rem;
  }

  .inline-action {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .top-list {
    margin-top: 0.9rem;
    display: grid;
    gap: 0.9rem;
  }

  .top-rated-cap {
    margin: 0.4rem 0 0;
  }

  .top-card {
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: 16px;
    padding: 1rem;
    display: grid;
    gap: 0.55rem;
  }

  .top-card.layout-split {
    grid-template-columns: 170px minmax(0, 1fr);
    grid-template-areas:
      'image head'
      'image excerpt'
      'image meta';
    align-items: start;
  }

  .top-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    grid-area: head;
  }

  .top-card-image-link {
    display: block;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 0.7rem;
    grid-area: image;
  }

  .top-card.layout-split .top-card-image-link {
    margin-bottom: 0;
    height: 114px;
  }

  .top-card-image {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    background: var(--surface-soft);
    height: 100%;
  }

  .top-card.layout-split .top-card-image {
    aspect-ratio: auto;
  }

  .title {
    font-weight: 600;
  }

  .pill {
    background: var(--primary-soft);
    color: var(--primary);
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .excerpt {
    margin: 0.65rem 0;
    color: var(--muted-text);
    grid-area: excerpt;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.82rem;
    color: var(--muted-text);
    grid-area: meta;
  }

  .dev-tools {
    margin-top: 1rem;
    display: grid;
    gap: 0.5rem;
  }

  .dev-tools .icon-button {
    width: 2.2rem;
    height: 2.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 999px;
    padding: 0;
    background: var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
  }

  .dev-tools .icon-button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .pull-message {
    margin: 0;
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .dev-tools .icon-button.pulling :global(svg) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  ul {
    padding-left: 1.2rem;
  }

  @media (max-width: 800px) {
    .hero {
      flex-direction: column;
      align-items: flex-start;
    }

    .stats-wrap {
      width: 100%;
      min-width: 0;
    }

    .section-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .top-card-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .top-card.layout-split {
      grid-template-columns: 1fr;
      grid-template-areas:
        'head'
        'image'
        'excerpt'
        'meta';
    }

    .top-card.layout-split .top-card-image-link {
      height: auto;
      margin-bottom: 0.4rem;
    }

    .top-card.layout-split .top-card-image {
      aspect-ratio: 16 / 9;
      height: auto;
    }

    .meta {
      flex-direction: column;
      gap: 0.2rem;
    }
  }

  @media (max-width: 520px) {
    .stats {
      grid-template-columns: 1fr;
    }
  }
</style>
