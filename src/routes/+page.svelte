<script>
  import { invalidateAll } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { IconClockPlay, IconExternalLink } from '$lib/icons';

  export let data;

  const PULL_SESSION_KEY = 'nebular:manual-pull-in-progress';
  const PULL_STATUS_POLL_MS = 1500;

  let isPulling = false;
  let pullMessage = '';
  let pullStatusTimer = null;
  let localPullRequestActive = false;
  let lastServerPullState = false;

  const readPullFlag = () => {
    try {
      return sessionStorage.getItem(PULL_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  };

  const writePullFlag = (value) => {
    try {
      if (value) {
        sessionStorage.setItem(PULL_SESSION_KEY, '1');
      } else {
        sessionStorage.removeItem(PULL_SESSION_KEY);
      }
    } catch {
      // Ignore session storage errors.
    }
  };

  const syncPullStatus = async () => {
    try {
      const res = await fetch('/api/pull');
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));
      const inProgress = Boolean(payload?.inProgress);
      const hadPendingFlag = readPullFlag();
      lastServerPullState = inProgress;

      if (inProgress) {
        isPulling = true;
        writePullFlag(true);
        return;
      }

      if (!localPullRequestActive) {
        isPulling = false;
        writePullFlag(false);
        if (hadPendingFlag) {
          if (!pullMessage) pullMessage = 'Pull finished. Refreshing dashboard...';
          await invalidateAll();
        }
      }
    } catch {
      // Ignore transient status errors.
    }
  };

  onMount(() => {
    const pending = readPullFlag();
    if (pending) {
      isPulling = true;
      void syncPullStatus();
    }

    pullStatusTimer = setInterval(() => {
      if (isPulling || readPullFlag() || lastServerPullState) {
        void syncPullStatus();
      }
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
    isPulling = true;
    pullMessage = '';
    localPullRequestActive = true;
    writePullFlag(true);
    const cycles = data.isDev ? 3 : 1;
    try {
      const res = await fetch('/api/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycles })
      });
      const payload = await res.json();
      if (!res.ok) {
        pullMessage = payload?.error ?? 'Manual pull failed';
        return;
      }
      pullMessage = `Pull complete (${payload.cycles} cycle${payload.cycles === 1 ? '' : 's'}). Due feeds: ${payload.stats.dueFeeds}, items seen: ${payload.stats.itemsSeen}, items processed: ${payload.stats.itemsProcessed}, articles: ${payload.stats.articles}, pending jobs: ${payload.stats.pendingJobs}, feeds with errors: ${payload.stats.feedsWithErrors}.`;
      if (payload.stats?.recentErrors?.length) {
        const first = payload.stats.recentErrors[0];
        pullMessage += ` First error: ${first.url} -> ${first.message}`;
      }
      await invalidateAll();
    } catch {
      pullMessage = 'Manual pull failed';
    } finally {
      localPullRequestActive = false;
      isPulling = false;
      writePullFlag(false);
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
    <h3>Top Rated Today ({data.topRatedConfig?.scoreCutoff ?? 3}+/5)</h3>
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
        <article class="top-card">
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
  }

  .top-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
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
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.82rem;
    color: var(--muted-text);
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
