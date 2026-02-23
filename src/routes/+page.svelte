<script>
  import { invalidate } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { liveEvents, startLiveEvents } from '$lib/client/live-events';
  import { IconClockPlay, IconExternalLink } from '$lib/icons';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';

  export let data;

  const PULL_SESSION_KEY = 'nebular:manual-pull-in-progress';
  const PULL_STATUS_POLL_MS = 5000;
  const LIVE_STATS_FALLBACK_POLL_MS = 60000;
  const PULL_START_GRACE_MS = 15000;
  const PULL_COMPLETION_SKEW_MS = 5000;
  const DEFAULT_DASHBOARD_REFRESH_MIN_MS = 30000;
  const DASHBOARD_REFRESH_MIN_MS = Math.max(
    10000,
    Number(data.liveConfig?.refreshMinMs ?? DEFAULT_DASHBOARD_REFRESH_MIN_MS)
  );
  const DASHBOARD_INVALIDATE_MIN_MS = Math.max(60000, DASHBOARD_REFRESH_MIN_MS);

  let isPulling = false;
  let pullMessage = '';
  let today = { ...(data.today ?? {}) };
  let lastServerTodaySignature = JSON.stringify(data.today ?? {});
  let pullStatusTimer = null;
  let liveSummaryTimer = null;
  let pullStatusSyncInFlight = false;
  let summaryRefreshInFlight = false;
  let pullTracker = { pending: false, startedAt: null, runId: null };
  let stopLiveEvents = () => {};
  let liveUnsubscribe = () => {};
  let summaryRefreshTimer = null;
  let invalidateTimer = null;
  let lastSummaryRefreshAt = 0;
  let lastInvalidateAt = 0;
  let lastLiveSignature = '';
  let liveConnected = false;

  const toFiniteNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const readPullTracker = () => {
    try {
      const raw = sessionStorage.getItem(PULL_SESSION_KEY);
      if (!raw) return { pending: false, startedAt: null, runId: null };
      if (raw === '1') return { pending: true, startedAt: Date.now(), runId: null };
      const parsed = JSON.parse(raw);
      return {
        pending: Boolean(parsed?.pending),
        startedAt: toFiniteNumber(parsed?.startedAt),
        runId: typeof parsed?.runId === 'string' && parsed.runId.trim() ? parsed.runId.trim() : null
      };
    } catch {
      return { pending: false, startedAt: null, runId: null };
    }
  };

  const writePullTracker = (value) => {
    try {
      if (value.pending) sessionStorage.setItem(PULL_SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(PULL_SESSION_KEY);
    } catch { /* ignore */ }
  };

  const clearPullTracker = () => {
    pullTracker = { pending: false, startedAt: null, runId: null };
    writePullTracker(pullTracker);
  };

  $: {
    const serverTodaySignature = JSON.stringify(data.today ?? {});
    if (serverTodaySignature !== lastServerTodaySignature) {
      today = { ...(data.today ?? {}) };
      lastServerTodaySignature = serverTodaySignature;
    }
  }

  const completionMatchesTracker = (completedAt, startedAt) => {
    if (completedAt === null) return false;
    if (startedAt === null) return true;
    return completedAt + PULL_COMPLETION_SKEW_MS >= startedAt;
  };

  const refreshLiveSummary = async (force = false) => {
    if (summaryRefreshInFlight) return;
    if (!force && lastSummaryRefreshAt && Date.now() - lastSummaryRefreshAt < DASHBOARD_REFRESH_MIN_MS) return;

    summaryRefreshInFlight = true;
    try {
      const res = await apiFetch('/api/dashboard/live-summary');
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));
      const liveSummary = payload?.data ?? payload;
      if (liveSummary?.today) {
        today = { ...today, ...liveSummary.today };
        lastSummaryRefreshAt = Date.now();
      }
    } catch {
      // Ignore transient live-summary fetch errors.
    } finally {
      summaryRefreshInFlight = false;
    }
  };

  const scheduleDashboardRefresh = (force = false) => {
    if (summaryRefreshTimer) return;
    const delayMs = force
      ? 0
      : Math.max(0, DASHBOARD_REFRESH_MIN_MS - (Date.now() - lastSummaryRefreshAt));
    summaryRefreshTimer = setTimeout(() => {
      summaryRefreshTimer = null;
      void refreshLiveSummary(true);
    }, delayMs);
  };

  const scheduleDashboardInvalidate = (force = false) => {
    if (invalidateTimer) return;
    const delayMs = force
      ? 0
      : Math.max(0, DASHBOARD_INVALIDATE_MIN_MS - (Date.now() - lastInvalidateAt));
    invalidateTimer = setTimeout(async () => {
      invalidateTimer = null;
      await invalidate('app:dashboard');
      lastInvalidateAt = Date.now();
    }, delayMs);
  };

  const applyPullState = async ({ inProgress, startedAt, completedAt, runId, lastRunStatus, lastError }) => {
    if (inProgress) {
      isPulling = true;
      if (!pullMessage) pullMessage = 'Pulling feeds now...';
      const nextStartedAt = pullTracker.startedAt ?? startedAt ?? Date.now();
      pullTracker = { pending: true, startedAt: nextStartedAt, runId: runId ?? pullTracker.runId };
      writePullTracker(pullTracker);
      return;
    }

    if (!pullTracker.pending) { isPulling = false; return; }

    const completedMatches = completionMatchesTracker(completedAt, pullTracker.startedAt);
    const waitingForStart = pullTracker.startedAt !== null && Date.now() - pullTracker.startedAt < PULL_START_GRACE_MS;

    if (!completedMatches && waitingForStart) { isPulling = true; return; }

    isPulling = false;
    clearPullTracker();
    if (completedMatches) {
      pullMessage = lastRunStatus === 'failed'
        ? (lastError ? `Pull failed: ${lastError}` : 'Pull failed.')
        : 'Pull complete. Refreshing...';
      await refreshLiveSummary(true);
      scheduleDashboardInvalidate(true);
      return;
    }
    pullMessage = 'Pull did not confirm start before timeout. Please try again.';
  };

  const syncPullStatus = async () => {
    if (pullStatusSyncInFlight) return;
    pullStatusSyncInFlight = true;
    try {
      const statusUrl = pullTracker.runId
        ? `/api/pull/status?run_id=${encodeURIComponent(pullTracker.runId)}`
        : '/api/pull/status';
      const res = await apiFetch(statusUrl);
      if (!res.ok) return;
      const payload = await res.json().catch(() => ({}));
      await applyPullState({
        inProgress: Boolean(payload?.in_progress),
        startedAt: toFiniteNumber(payload?.started_at),
        completedAt: toFiniteNumber(payload?.completed_at),
        runId: typeof payload?.run_id === 'string' && payload.run_id.trim() ? payload.run_id.trim() : null,
        lastRunStatus: payload?.last_run_status === 'success' || payload?.last_run_status === 'failed' ? payload.last_run_status : null,
        lastError: typeof payload?.last_error === 'string' && payload.last_error.length > 0 ? payload.last_error : null
      });
    } catch { /* ignore */ } finally {
      pullStatusSyncInFlight = false;
    }
  };

  onMount(() => {
    pullTracker = readPullTracker();
    if (pullTracker.pending) { isPulling = true; if (!pullMessage) pullMessage = 'Pulling feeds now...'; }

    stopLiveEvents = startLiveEvents();
    liveUnsubscribe = liveEvents.subscribe((snapshot) => {
      liveConnected = snapshot.connected;
      const jobsSig = snapshot.jobs ? `${snapshot.jobs.pending}:${snapshot.jobs.running}:${snapshot.jobs.failed}:${snapshot.jobs.done}` : 'jobs:none';
      const pullSig = snapshot.pull ? `${snapshot.pull.status ?? 'none'}:${snapshot.pull.in_progress ? 1 : 0}:${snapshot.pull.run_id ?? ''}:${snapshot.pull.completed_at ?? ''}` : 'pull:none';
      const signature = `${jobsSig}|${pullSig}`;
      if (signature !== lastLiveSignature) {
        lastLiveSignature = signature;
        scheduleDashboardRefresh();
        scheduleDashboardInvalidate();
      }
      if (snapshot.pull) {
        void applyPullState({
          inProgress: Boolean(snapshot.pull.in_progress),
          startedAt: toFiniteNumber(snapshot.pull.started_at),
          completedAt: toFiniteNumber(snapshot.pull.completed_at),
          runId: snapshot.pull.run_id ?? null,
          lastRunStatus: snapshot.pull.last_run_status,
          lastError: snapshot.pull.last_error
        });
      }
    });

    void syncPullStatus();
    void refreshLiveSummary(true);
    pullStatusTimer = setInterval(() => {
      if (!isPulling && liveConnected) return;
      void syncPullStatus();
    }, PULL_STATUS_POLL_MS);
    liveSummaryTimer = setInterval(() => {
      if (liveConnected) return;
      void refreshLiveSummary();
    }, LIVE_STATS_FALLBACK_POLL_MS);
  });

  onDestroy(() => {
    if (pullStatusTimer) { clearInterval(pullStatusTimer); pullStatusTimer = null; }
    if (liveSummaryTimer) { clearInterval(liveSummaryTimer); liveSummaryTimer = null; }
    liveUnsubscribe();
    stopLiveEvents();
    if (summaryRefreshTimer) { clearTimeout(summaryRefreshTimer); summaryRefreshTimer = null; }
    if (invalidateTimer) { clearTimeout(invalidateTimer); invalidateTimer = null; }
  });

  const scoreLabel = (score) => {
    if (score >= 5) return 'Perfect fit';
    if (score >= 4) return 'Strong fit';
    return 'Good fit';
  };

  const articleSnippet = (article) => {
    const text = article.summary_text ?? article.excerpt ?? '';
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  };

  const runManualPull = async () => {
    if (isPulling) return;
    isPulling = true;
    pullMessage = '';
    pullTracker = { pending: true, startedAt: Date.now(), runId: null };
    writePullTracker(pullTracker);
    const cycles = data.isDev ? 3 : 1;
    try {
      const res = await apiFetch('/api/pull', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cycles })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          isPulling = true;
          pullMessage = payload?.error ?? 'Manual pull already in progress';
          if (payload?.run_id) { pullTracker = { ...pullTracker, runId: payload.run_id }; writePullTracker(pullTracker); }
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
        pullTracker = { pending: true, startedAt: pullTracker.startedAt ?? Date.now(), runId: payload?.run_id ?? null };
        writePullTracker(pullTracker);
        pullMessage = 'Pull started. Running in background...';
        void syncPullStatus();
        return;
      }
      pullMessage = `Pull complete. ${payload.stats?.articles ?? 0} articles, ${payload.stats?.pendingJobs ?? 0} jobs queued.`;
      isPulling = false;
      clearPullTracker();
      await refreshLiveSummary(true);
      scheduleDashboardInvalidate(true);
    } catch (error) {
      if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return;
      pullMessage = 'Manual pull failed';
      isPulling = false;
      clearPullTracker();
    }
  };
</script>

<!-- Hero -->
<section class="hero">
  <div class="hero-left">
    <h1>Your Nebula</h1>
    <p class="hero-desc">Track the pulse of your feeds, summaries, and personalization queue.</p>

    <div class="pull-section">
      <Button
        variant="primary"
        size="inline"
        on:click={runManualPull}
        disabled={isPulling}
        title={isPulling ? 'Pull in progress' : 'Pull feeds now'}
      >
        <span class="icon-wrap" class:spinning={isPulling}><IconClockPlay size={16} stroke={1.9} /></span>
        <span>{isPulling ? 'Pulling...' : 'Pull feeds now'}</span>
      </Button>
      {#if pullMessage}
        <p class="pull-msg" role="status" aria-live="polite">{pullMessage}</p>
      {/if}
      <span class="live-badge" class:live={liveConnected}>
        {liveConnected ? '● Live' : '○ Connecting...'}
      </span>
    </div>
  </div>

  <div class="hero-stats">
    <div class="stats-header">
      <h3>Today's pipeline</h3>
      <a href="/jobs" class="view-all">
        <IconExternalLink size={13} stroke={1.9} />
        <span>Jobs</span>
      </a>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-num">{today.articles}</div>
        <div class="stat-lbl">Articles</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{today.summaries}</div>
        <div class="stat-lbl">Summarized</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{today.scores}</div>
        <div class="stat-lbl">Scored</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" class:warn={today.pendingJobs > 0}>{today.pendingJobs}</div>
        <div class="stat-lbl">Jobs pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" class:warn={today.missingSummaries > 0}>{today.missingSummaries}</div>
        <div class="stat-lbl">Missing summaries</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" class:warn={today.missingScores > 0}>{today.missingScores}</div>
        <div class="stat-lbl">Missing scores</div>
      </div>
    </div>
  </div>
</section>

<!-- Top Rated -->
<section class="top-rated">
  <div class="section-head">
    <h2>Top Rated Today</h2>
    <a href={data.topRatedConfig?.href ?? '/articles'} class="view-all">
      <IconExternalLink size={13} stroke={1.9} />
      <span>Full list</span>
    </a>
  </div>
  <p class="section-cap">Showing up to {data.topRatedConfig?.limit ?? 5} highest-scored items.</p>

  {#if data.topRatedArticles.length === 0}
    <div class="empty-top">
      <p>No top-rated articles yet today. Run a pull or wait for scoring to finish.</p>
    </div>
  {:else}
    <div class="top-grid layout-{data.topRatedConfig?.layout ?? 'stacked'}">
      {#each data.topRatedArticles as article}
        <article class="top-card">
          <a class="card-img-wrap" href={`/articles/${article.id}`}>
            <img
              class="card-img"
              src={resolveArticleImageUrl(article)}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </a>
          <div class="card-body">
            <div class="card-top-row">
              <a class="card-title" href={`/articles/${article.id}`}>{article.title ?? 'Untitled article'}</a>
              <Pill>{article.score}/5 · {scoreLabel(article.score)}</Pill>
            </div>
            <p class="card-excerpt">{articleSnippet(article)}</p>
            <div class="card-meta">
              <span>{article.source_name ?? 'Unknown source'}</span>
              <span>{new Date(article.published_at ?? article.fetched_at).toLocaleString()}</span>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

{#if data.stats.feeds === 0}
  <Card variant="default">
    <h3>Get started</h3>
    <ul>
      <li>Add your first feed in <a href="/feeds">Feeds</a>.</li>
      <li>Run a manual pull to ingest your first articles.</li>
      <li>Set provider keys in <a href="/settings">Settings</a> to enable summaries and scoring.</li>
    </ul>
  </Card>
{/if}

<style>
  /* Hero */
  .hero {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-8);
    margin-bottom: var(--space-8);
  }

  .hero-left {
    flex: 0 0 auto;
    max-width: 360px;
  }

  h1 {
    font-family: 'Source Serif 4', serif;
    font-size: 2.6rem;
    margin: 0 0 var(--space-2);
    line-height: 1.1;
  }

  .hero-desc {
    color: var(--muted-text);
    margin: 0 0 var(--space-5);
    line-height: 1.5;
  }

  .pull-section {
    display: grid;
    gap: var(--space-2);
  }

  .icon-wrap {
    display: inline-flex;
    align-items: center;
  }

  .icon-wrap.spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .pull-msg {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .live-badge {
    font-size: var(--text-xs);
    color: var(--muted-text);
  }

  .live-badge.live {
    color: #91f0cd;
  }

  /* Stats */
  .hero-stats {
    flex: 1 1 0;
    min-width: 0;
  }

  .stats-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .stats-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  .stat-card {
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    text-align: center;
    box-shadow: var(--shadow-sm);
  }

  .stat-num {
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--primary);
    line-height: 1;
  }

  .stat-num.warn {
    color: #ff9dbc;
  }

  .stat-lbl {
    font-size: var(--text-sm);
    color: var(--muted-text);
    margin-top: var(--space-1);
  }

  /* Top Rated */
  .top-rated {
    background: var(--surface);
    border-radius: var(--radius-xl);
    border: 1px solid var(--surface-border);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
  }

  .section-head h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .view-all {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--primary);
    font-size: var(--text-sm);
  }

  .section-cap {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .empty-top {
    padding: var(--space-6) 0;
    color: var(--muted-text);
  }

  .top-grid {
    display: grid;
    gap: var(--space-4);
  }

  .top-card {
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: grid;
  }

  .layout-split .top-card {
    grid-template-columns: 180px 1fr;
  }

  .layout-stacked .top-card {
    grid-template-columns: 1fr;
  }

  .card-img-wrap {
    display: block;
    overflow: hidden;
    background: var(--surface-soft);
  }

  .layout-split .card-img-wrap {
    height: 120px;
  }

  .layout-stacked .card-img-wrap {
    height: 160px;
  }

  .card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-body {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
    align-content: start;
  }

  .card-top-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .card-title {
    font-weight: 600;
    color: var(--text-color);
    text-decoration: none;
    line-height: 1.35;
  }

  .card-title:hover {
    color: var(--primary);
  }

  .card-excerpt {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-text);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-meta {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--muted-text);
  }

  /* Get started */
  :global(.card) ul {
    padding-left: 1.2rem;
    margin: 0;
  }

  :global(.card) h3 {
    margin: 0;
  }

  @media (max-width: 860px) {
    .hero {
      flex-direction: column;
    }

    .hero-left {
      max-width: none;
    }

    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .layout-split .top-card {
      grid-template-columns: 1fr;
    }

    .layout-split .card-img-wrap {
      height: 160px;
    }
  }

  @media (max-width: 480px) {
    .stats-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
