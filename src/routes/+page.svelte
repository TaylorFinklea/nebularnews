<script>
  import { invalidate } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { showToast } from '$lib/client/toast';
  import { IconClockPlay, IconExternalLink, IconStars } from '$lib/icons';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import Button from '$lib/components/Button.svelte';

  export let data;

  const PULL_SESSION_KEY = 'nebular:manual-pull-in-progress';
  const HEARTBEAT_VISIBLE_POLL_MS = 30000;
  const HEARTBEAT_HIDDEN_POLL_MS = 90000;
  const PULL_START_GRACE_MS = 15000;
  const PULL_COMPLETION_SKEW_MS = 5000;

  const EMPTY_MOMENTUM = {
    unreadTotal: 0,
    unread24h: 0,
    unread7d: 0,
    highFitUnread7d: 0
  };

  let isPulling = false;
  let pullMessage = '';
  let queueItems = [...(data.readingQueue ?? [])];
  let momentum = { ...(data.momentum ?? EMPTY_MOMENTUM) };
  let lastServerQueueSignature = JSON.stringify(data.readingQueue ?? []);
  let lastServerMomentumSignature = JSON.stringify(data.momentum ?? EMPTY_MOMENTUM);
  let pendingReadById = {};
  let hiddenQueueIds = new Set();

  let syncInFlight = false;
  let pullTracker = { pending: false, startedAt: null, runId: null };
  let heartbeatTimer = null;
  let liveConnected = false;
  let heartbeatDegraded = false;

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
    } catch {
      // Ignore sessionStorage write failures.
    }
  };

  const clearPullTracker = () => {
    pullTracker = { pending: false, startedAt: null, runId: null };
    writePullTracker(pullTracker);
  };

  $: {
    const serverQueueSignature = JSON.stringify(data.readingQueue ?? []);
    if (serverQueueSignature !== lastServerQueueSignature) {
      queueItems = (data.readingQueue ?? []).filter((article) => !hiddenQueueIds.has(article.id));
      lastServerQueueSignature = serverQueueSignature;
    }
  }

  $: {
    const serverMomentumSignature = JSON.stringify(data.momentum ?? EMPTY_MOMENTUM);
    if (serverMomentumSignature !== lastServerMomentumSignature) {
      momentum = { ...(data.momentum ?? EMPTY_MOMENTUM) };
      lastServerMomentumSignature = serverMomentumSignature;
    }
  }

  const completionMatchesTracker = (completedAt, startedAt) => {
    if (completedAt === null) return false;
    if (startedAt === null) return true;
    return completedAt + PULL_COMPLETION_SKEW_MS >= startedAt;
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

    if (!pullTracker.pending) {
      isPulling = false;
      return;
    }

    const completedMatches = completionMatchesTracker(completedAt, pullTracker.startedAt);
    const waitingForStart = pullTracker.startedAt !== null && Date.now() - pullTracker.startedAt < PULL_START_GRACE_MS;

    if (!completedMatches && waitingForStart) {
      isPulling = true;
      return;
    }

    isPulling = false;
    clearPullTracker();
    if (completedMatches) {
      pullMessage = lastRunStatus === 'failed'
        ? (lastError ? `Pull failed: ${lastError}` : 'Pull failed.')
        : 'Pull complete. Refreshing...';
      await invalidate('app:dashboard');
      return;
    }
    pullMessage = 'Pull did not confirm start before timeout. Please try again.';
  };

  const syncHeartbeat = async () => {
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const res = await apiFetch('/api/live/heartbeat');
      if (!res.ok) {
        liveConnected = false;
        return;
      }

      const payload = await res.json().catch(() => ({}));
      const heartbeat = payload?.data ?? payload;
      liveConnected = true;
      heartbeatDegraded = Boolean(heartbeat?.degraded);

      const pull = heartbeat?.pull ?? {};
      await applyPullState({
        inProgress: Boolean(pull?.in_progress),
        startedAt: toFiniteNumber(pull?.started_at),
        completedAt: toFiniteNumber(pull?.completed_at),
        runId: typeof pull?.run_id === 'string' && pull.run_id.trim() ? pull.run_id.trim() : null,
        lastRunStatus: pull?.last_run_status === 'success' || pull?.last_run_status === 'failed' ? pull.last_run_status : null,
        lastError: typeof pull?.last_error === 'string' && pull.last_error.length > 0 ? pull.last_error : null
      });
    } catch {
      liveConnected = false;
    } finally {
      syncInFlight = false;
    }
  };

  const nextHeartbeatInterval = () => {
    if (typeof document === 'undefined') return HEARTBEAT_VISIBLE_POLL_MS;
    return document.visibilityState === 'hidden'
      ? HEARTBEAT_HIDDEN_POLL_MS
      : HEARTBEAT_VISIBLE_POLL_MS;
  };

  const clearHeartbeatTimer = () => {
    if (!heartbeatTimer) return;
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  };

  const scheduleHeartbeat = (immediate = false) => {
    clearHeartbeatTimer();
    heartbeatTimer = setTimeout(async () => {
      heartbeatTimer = null;
      await syncHeartbeat();
      scheduleHeartbeat(false);
    }, immediate ? 0 : nextHeartbeatInterval());
  };

  const handleVisibilityChange = () => {
    scheduleHeartbeat(true);
  };

  onMount(() => {
    pullTracker = readPullTracker();
    if (pullTracker.pending) {
      isPulling = true;
      if (!pullMessage) pullMessage = 'Pulling feeds now...';
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    scheduleHeartbeat(true);
  });

  onDestroy(() => {
    clearHeartbeatTimer();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  });

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

  const articleSnippet = (article) => {
    const text = article.summary_text ?? article.excerpt ?? '';
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  };

  const defaultAllArticlesHref = '/articles?reaction=up&reaction=none';
  const defaultUnreadHref = '/articles?read=unread&sort=unread_first&reaction=up&reaction=none';
  const defaultHighFitUnreadHref = '/articles?read=unread&sort=unread_first&sinceDays=7&score=5&score=4&score=3&reaction=up&reaction=none';
  const queueArticleHref = (article) => {
    const fromHref = article?.queue_reason === 'high_fit'
      ? (data.queueConfig?.hrefHighFitUnread ?? defaultHighFitUnreadHref)
      : (data.queueConfig?.hrefUnread ?? defaultUnreadHref);
    return `/articles/${article.id}?from=${encodeURIComponent(fromHref)}`;
  };

  const formatTimestamp = (article) => {
    const value = article.published_at ?? article.fetched_at;
    if (!value) return 'No date';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'No date' : parsed.toLocaleString();
  };

  const setPendingRead = (articleId, value) => {
    if (value) {
      pendingReadById = { ...pendingReadById, [articleId]: true };
      return;
    }
    if (!pendingReadById[articleId]) return;
    const next = { ...pendingReadById };
    delete next[articleId];
    pendingReadById = next;
  };

  const markQueueItemRead = async (articleId) => {
    if (pendingReadById[articleId]) return;
    const index = queueItems.findIndex((item) => item.id === articleId);
    if (index === -1) return;

    const article = queueItems[index];
    hiddenQueueIds.add(articleId);
    queueItems = queueItems.filter((item) => item.id !== articleId);
    setPendingRead(articleId, true);

    try {
      const res = await apiFetch(`/api/articles/${articleId}/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isRead: true })
      });
      if (!res.ok) {
        throw new Error('mark_read_failed');
      }
      await invalidate('app:dashboard');
      hiddenQueueIds.delete(articleId);
    } catch {
      hiddenQueueIds.delete(articleId);
      queueItems = [...queueItems.slice(0, index), article, ...queueItems.slice(index)];
      showToast('Unable to mark article as read. Reverted.', 'error');
    } finally {
      setPendingRead(articleId, false);
    }
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
          pullMessage = payload?.error?.message ?? payload?.error ?? 'Manual pull already in progress';
          const conflictRunId = payload?.error?.details?.run_id ?? payload?.run_id ?? null;
          if (conflictRunId) {
            pullTracker = { ...pullTracker, runId: conflictRunId };
            writePullTracker(pullTracker);
          }
          scheduleHeartbeat(true);
          return;
        }

        pullMessage = payload?.error?.message ?? payload?.error ?? 'Manual pull failed';
        isPulling = false;
        clearPullTracker();
        return;
      }

      if (payload?.started) {
        isPulling = true;
        pullTracker = { pending: true, startedAt: pullTracker.startedAt ?? Date.now(), runId: payload?.run_id ?? null };
        writePullTracker(pullTracker);
        pullMessage = 'Pull queued. Running in scheduled slices...';
        scheduleHeartbeat(true);
        return;
      }

      pullMessage = `Pull complete. ${payload.stats?.articles ?? 0} articles, ${payload.stats?.pendingJobs ?? 0} jobs queued.`;
      isPulling = false;
      clearPullTracker();
      await invalidate('app:dashboard');
    } catch (error) {
      if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return;
      pullMessage = 'Manual pull failed';
      isPulling = false;
      clearPullTracker();
    }
  };
</script>


<div class="dashboard-shell">
  <section class="hero-utility surface-panel">
    <div class="hero-copy">
      <p class="hero-kicker">Landing View</p>
      <h1>Your Reading Queue</h1>
      <p class="hero-desc">Pick up where you left off with the most relevant unread stories and jump straight back into reading.</p>
      <div class="hero-chips">
        <span class="hero-chip">Top {data.queueConfig?.limit ?? 6} unread picks</span>
        <span class="hero-chip">Last {data.queueConfig?.windowDays ?? 7} days</span>
        <span class="hero-chip">High fit first</span>
      </div>
    </div>

    <div class="pull-card">
      <div class="pull-copy">
        <p class="pull-kicker">Manual refresh</p>
        <span class="live-badge" class:live={liveConnected}>
          {#if liveConnected}
            {heartbeatDegraded ? '◐ Live (throttled)' : '● Live'}
          {:else}
            ○ Connecting...
          {/if}
        </span>
      </div>

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
    </div>
  </section>

  <section class="reading-queue surface-panel">
    <div class="section-head">
      <div class="section-copy">
        <h2>Top Unread · Last {data.queueConfig?.windowDays ?? 7} Days</h2>
        <p class="section-cap">
          Showing up to {data.queueConfig?.limit ?? 6} articles. High-fit stories are listed first and recent unread backfills the rest.
        </p>
      </div>
      <a href={data.queueConfig?.hrefUnread ?? defaultUnreadHref} class="view-all">
        <IconExternalLink size={13} stroke={1.9} />
        <span>View unread</span>
      </a>
    </div>

    {#if queueItems.length === 0}
      <div class="queue-empty">
        <p>You're caught up on unread articles in this window.</p>
        <div class="empty-actions">
          <a href={data.queueConfig?.hrefUnread ?? defaultUnreadHref}>Browse unread articles</a>
          <button type="button" on:click={runManualPull} disabled={isPulling}>Pull latest feeds</button>
        </div>
      </div>
    {:else}
      <div class="queue-grid">
        {#each queueItems as article}
          <article class="queue-card">
            <a class="card-img-wrap" href={queueArticleHref(article)}>
              <img
                class="card-img"
                src={resolveArticleImageUrl(article)}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </a>

            <div class="card-body">
              <div class="card-meta-row">
                <span class="source-pill">{article.source_name ?? 'Unknown source'}</span>
                <span
                  class={`fit-pill ${fitScoreTone(article.score)}`}
                  title={fitScoreAria(article.score)}
                  aria-label={fitScoreAria(article.score)}
                >
                  <IconStars size={13} stroke={1.9} />
                  <span>{fitScoreText(article.score)}</span>
                </span>
              </div>

              <a class="card-title" href={queueArticleHref(article)}>{article.title ?? 'Untitled article'}</a>

              <div class="reason-row">
                <span class="reason-chip" class:high={article.queue_reason === 'high_fit'}>
                  {article.queue_reason === 'high_fit' ? 'High fit' : 'Recent unread'}
                </span>
                <span class="timestamp-chip">{formatTimestamp(article)}</span>
              </div>

              <p class="card-excerpt">{articleSnippet(article)}</p>

              <div class="card-actions">
                <a class="open-link" href={queueArticleHref(article)}>Open</a>
                <button
                  type="button"
                  class="mark-read"
                  on:click={() => markQueueItemRead(article.id)}
                  disabled={Boolean(pendingReadById[article.id])}
                >
                  {#if pendingReadById[article.id]}Saving...{:else}Mark read{/if}
                </button>
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <section class="momentum surface-panel">
    <div class="section-head">
      <div class="section-copy">
        <h2>Reading Momentum</h2>
        <p class="section-cap">Every card is a shortcut into the matching Articles view.</p>
      </div>
      <a href={data.momentumLinks?.allArticles ?? defaultAllArticlesHref} class="view-all">
        <IconExternalLink size={13} stroke={1.9} />
        <span>Articles</span>
      </a>
    </div>

    <div class="momentum-grid">
      <a class="momentum-card is-link" href={data.momentumLinks?.unreadTotal ?? defaultUnreadHref}>
        <div class="momentum-label">Unread total</div>
        <div class="momentum-num">{momentum.unreadTotal}</div>
        <div class="momentum-meta">Open unread queue</div>
      </a>
      <a class="momentum-card is-link" href={data.momentumLinks?.unread24h ?? `${defaultUnreadHref}&sinceDays=1`}>
        <div class="momentum-label">Unread · 24h</div>
        <div class="momentum-num">{momentum.unread24h}</div>
        <div class="momentum-meta">Recent unread stories</div>
      </a>
      <a class="momentum-card is-link" href={data.momentumLinks?.unread7d ?? `${defaultUnreadHref}&sinceDays=7`}>
        <div class="momentum-label">Unread · 7d</div>
        <div class="momentum-num">{momentum.unread7d}</div>
        <div class="momentum-meta">Seven-day reading backlog</div>
      </a>
      <a class="momentum-card is-link" href={data.momentumLinks?.highFitUnread7d ?? defaultHighFitUnreadHref}>
        <div class="momentum-label">High fit · 7d</div>
        <div class="momentum-num">{momentum.highFitUnread7d}</div>
        <div class="momentum-meta">Most relevant unread stories</div>
      </a>
    </div>

    <div class="quick-links">
      <a href={data.queueConfig?.hrefUnread ?? defaultUnreadHref}>Open unread queue</a>
      <a href={data.queueConfig?.hrefHighFitUnread ?? defaultHighFitUnreadHref}>Open high-fit unread</a>
      <a href={data.momentumLinks?.allArticles ?? defaultAllArticlesHref}>Browse all articles</a>
    </div>
  </section>

  {#if !data.hasFeeds}
    <section class="onboarding-panel surface-panel">
      <p class="hero-kicker">First Run</p>
      <h2>Get started</h2>
      <ul>
        <li>Add your first feed in <a href="/feeds">Feeds</a>.</li>
        <li>Run a manual pull to ingest your first articles.</li>
        <li>Set provider keys in <a href="/settings">Settings</a> to enable summaries and scoring.</li>
      </ul>
    </section>
  {/if}
</div>

<style>
  .dashboard-shell {
    min-width: 0;
    display: grid;
    gap: clamp(1.15rem, 2vw, 1.8rem);
    width: 100%;
    max-width: min(100%, 86rem);
    margin-inline: auto;
  }

  .surface-panel,
  .hero-copy,
  .pull-card,
  .pull-copy,
  .hero-chips,
  .section-copy,
  .queue-grid,
  .queue-card,
  .card-body,
  .card-meta-row,
  .reason-row,
  .card-actions,
  .momentum-grid,
  .quick-links,
  .empty-actions {
    min-width: 0;
  }

  .surface-panel {
    padding: clamp(1.05rem, 1.9vw, 1.55rem) 0;
    border-radius: 0;
    border: none;
    border-bottom: 1px solid var(--surface-border);
    background: transparent;
    overflow: clip;
  }

  .hero-utility {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: clamp(1rem, 2vw, 2rem);
    flex-wrap: wrap;
    background: transparent;
  }

  .hero-copy {
    max-width: 40rem;
    display: grid;
    gap: 0.45rem;
  }

  .hero-kicker,
  .pull-kicker {
    margin: 0;
    color: var(--muted-text);
    font-size: var(--text-xs);
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  h1,
  .hero-desc,
  .pull-msg,
  .section-cap,
  .queue-empty p,
  .section-head h2,
  .onboarding-panel h2,
  .onboarding-panel ul {
    margin: 0;
  }

  h1 {
    font-size: clamp(2rem, 3.1vw, 3.5rem);
    font-weight: 650;
    line-height: 1.02;
    letter-spacing: -0.03em;
  }

  .hero-desc {
    color: var(--muted-text);
    line-height: 1.65;
    max-width: 35rem;
    overflow-wrap: anywhere;
  }

  .hero-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .hero-chip,
  .source-pill,
  .timestamp-chip,
  .reason-chip,
  .live-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.8rem;
    padding: 0.22rem 0.58rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
    font-size: var(--text-xs);
  }

  .hero-chip,
  .timestamp-chip,
  .live-badge {
    color: var(--muted-text);
  }

  .source-pill {
    color: var(--text-color);
    font-weight: 600;
  }

  .pull-card {
    min-width: min(100%, 19rem);
    display: grid;
    gap: var(--space-3);
    padding: 0.95rem 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface);
  }

  .pull-copy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
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
    font-size: var(--text-sm);
    color: var(--muted-text);
    line-height: 1.55;
  }

  .live-badge.live {
    color: #91f0cd;
  }

  .section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .section-copy {
    display: grid;
    gap: 0.35rem;
  }

  .section-head h2,
  .onboarding-panel h2 {
    font-size: clamp(1.2rem, 1.5vw, 1.45rem);
    font-weight: 650;
  }

  .view-all {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 42px;
    padding: 0.65rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: transparent;
    color: var(--text-color);
    font-size: var(--text-sm);
    text-decoration: none;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .view-all:hover {
    border-color: var(--primary);
    background: var(--surface-soft);
  }

  .section-cap {
    color: var(--muted-text);
    font-size: var(--text-sm);
    line-height: 1.55;
  }

  .queue-grid {
    display: grid;
    gap: clamp(0.95rem, 1.4vw, 1.2rem);
  }

  .queue-card {
    display: grid;
    grid-template-columns: minmax(210px, 235px) minmax(0, 1fr);
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface);
    overflow: clip;
    transition: border-color var(--transition-fast);
  }

  .queue-card:hover {
    border-color: var(--primary);
  }

  .card-img-wrap {
    display: block;
    min-height: 100%;
    background: var(--surface-soft);
  }

  .card-img {
    width: 100%;
    height: 100%;
    min-height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-body {
    padding: clamp(0.95rem, 1.5vw, 1.2rem);
    display: grid;
    gap: 0.8rem;
    align-content: start;
  }

  .card-meta-row,
  .reason-row,
  .card-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .card-title {
    font-weight: 650;
    font-size: clamp(1.02rem, 1.3vw, 1.18rem);
    color: var(--text-color);
    text-decoration: none;
    line-height: 1.24;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }

  .card-title:hover {
    color: var(--primary);
  }

  .fit-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
    color: var(--muted-text);
    padding: 0.24rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1;
    flex-shrink: 0;
  }

  .fit-pill.fit-1 {
    color: #fca5a5;
    background: rgba(252, 165, 165, 0.12);
  }

  .fit-pill.fit-2 {
    color: #fdba74;
    background: rgba(253, 186, 116, 0.12);
  }

  .fit-pill.fit-3 {
    color: #c4b5fd;
    background: rgba(196, 181, 253, 0.14);
  }

  .fit-pill.fit-4 {
    color: #67e8f9;
    background: rgba(103, 232, 249, 0.14);
  }

  .fit-pill.fit-5 {
    color: #86efac;
    background: rgba(134, 239, 172, 0.14);
  }

  .reason-chip {
    color: var(--muted-text);
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    border-radius: var(--radius-sm);
  }

  .reason-chip.high {
    color: #86efac;
    background: rgba(134, 239, 172, 0.12);
  }

  .card-excerpt {
    margin: 0;
    color: var(--muted-text);
    line-height: 1.65;
    font-size: var(--text-sm);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .open-link,
  .mark-read,
  .empty-actions a,
  .empty-actions button,
  .quick-links a {
    min-height: 42px;
    border-radius: var(--radius-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.7rem 1rem;
    font-size: var(--text-sm);
    text-decoration: none;
    font-family: inherit;
    transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
  }

  .open-link,
  .empty-actions a,
  .empty-actions button,
  .quick-links a {
    border: 1px solid var(--surface-border);
    background: transparent;
    color: var(--text-color);
  }

  .mark-read {
    border: 1px solid var(--surface-border);
    background: var(--primary-soft);
    color: var(--text-color);
    cursor: pointer;
  }

  .open-link:hover,
  .mark-read:hover:not(:disabled),
  .empty-actions a:hover,
  .empty-actions button:hover,
  .quick-links a:hover {
    border-color: var(--primary);
  }

  .mark-read:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .queue-empty {
    padding: clamp(1.3rem, 3vw, 2rem) var(--space-1);
    color: var(--muted-text);
    display: grid;
    gap: var(--space-3);
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .momentum-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .momentum-card {
    display: grid;
    gap: 0.45rem;
    padding: 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface);
    text-decoration: none;
    color: inherit;
    transition: border-color var(--transition-fast);
  }

  .momentum-card:hover {
    border-color: var(--primary);
  }

  .momentum-label {
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .momentum-num {
    font-size: clamp(1.7rem, 2.2vw, 2.2rem);
    line-height: 1;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text-color);
  }

  .momentum-meta {
    font-size: var(--text-xs);
    color: var(--muted-text);
    overflow-wrap: anywhere;
  }

  .quick-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .onboarding-panel {
    display: grid;
    gap: 0.65rem;
  }

  .onboarding-panel ul {
    padding-left: 1.2rem;
    display: grid;
    gap: 0.45rem;
  }

  @media (max-width: 940px) {
    .hero-utility {
      flex-direction: column;
    }

    .pull-card {
      min-width: 0;
      width: 100%;
    }

    .queue-card {
      grid-template-columns: 1fr;
    }

    .card-img-wrap {
      aspect-ratio: 16 / 9;
    }

    .momentum-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    h1 {
      font-size: 1.9rem;
    }

    .momentum-grid {
      grid-template-columns: 1fr 1fr;
    }

    .open-link,
    .mark-read,
    .empty-actions a,
    .empty-actions button,
    .quick-links a,
    .view-all {
      flex: 1 1 12rem;
    }
  }
</style>
