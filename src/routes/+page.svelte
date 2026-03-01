<script>
  import { invalidate } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { showToast } from '$lib/client/toast';
  import { IconClockPlay, IconExternalLink, IconStars } from '$lib/icons';
  import { resolveArticleImageUrl } from '$lib/article-image';
  import Card from '$lib/components/Card.svelte';
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

<section class="hero-utility">
  <div>
    <h1>Your Reading Queue</h1>
    <p class="hero-desc">Pick up where you left off with the most relevant unread stories.</p>
  </div>

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
      {#if liveConnected}
        {heartbeatDegraded ? '◐ Live (throttled)' : '● Live'}
      {:else}
        ○ Connecting...
      {/if}
    </span>
  </div>
</section>

<section class="reading-queue">
  <div class="section-head">
    <h2>Top Unread · Last {data.queueConfig?.windowDays ?? 7} Days</h2>
    <a href={data.queueConfig?.hrefUnread ?? '/articles?read=unread&sort=unread_first'} class="view-all">
      <IconExternalLink size={13} stroke={1.9} />
      <span>View unread</span>
    </a>
  </div>
  <p class="section-cap">
    Showing up to {data.queueConfig?.limit ?? 6} articles. High-fit stories are listed first.
  </p>

  {#if queueItems.length === 0}
    <div class="queue-empty">
      <p>You're caught up on unread articles in this window.</p>
      <div class="empty-actions">
        <a href={data.queueConfig?.hrefUnread ?? '/articles?read=unread&sort=unread_first'}>Browse unread articles</a>
        <button type="button" on:click={runManualPull} disabled={isPulling}>Pull latest feeds</button>
      </div>
    </div>
  {:else}
    <div class="queue-grid">
      {#each queueItems as article}
        <article class="queue-card">
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
              <span
                class={`fit-pill ${fitScoreTone(article.score)}`}
                title={fitScoreAria(article.score)}
                aria-label={fitScoreAria(article.score)}
              >
                <IconStars size={13} stroke={1.9} />
                <span>{fitScoreText(article.score)}</span>
              </span>
            </div>

            <div class="reason-row">
              <span class="reason-chip" class:high={article.queue_reason === 'high_fit'}>
                {article.queue_reason === 'high_fit' ? 'High fit' : 'Recent unread'}
              </span>
            </div>

            <p class="card-excerpt">{articleSnippet(article)}</p>

            <div class="card-meta">
              <span>{article.source_name ?? 'Unknown source'}</span>
              <span>{formatTimestamp(article)}</span>
            </div>

            <div class="card-actions">
              <a class="open-link" href={`/articles/${article.id}`}>Open</a>
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

<section class="momentum">
  <div class="section-head">
    <h2>Reading Momentum</h2>
    <a href="/articles" class="view-all">
      <IconExternalLink size={13} stroke={1.9} />
      <span>Articles</span>
    </a>
  </div>

  <div class="momentum-grid">
    <a class="momentum-card is-link" href={data.momentumLinks?.unreadTotal ?? '/articles?read=unread&sort=unread_first'}>
      <div class="momentum-num">{momentum.unreadTotal}</div>
      <div class="momentum-label">Unread total</div>
    </a>
    <a class="momentum-card is-link" href={data.momentumLinks?.unread24h ?? '/articles?read=unread&sort=unread_first&sinceDays=1'}>
      <div class="momentum-num">{momentum.unread24h}</div>
      <div class="momentum-label">Unread · 24h</div>
    </a>
    <a class="momentum-card is-link" href={data.momentumLinks?.unread7d ?? '/articles?read=unread&sort=unread_first&sinceDays=7'}>
      <div class="momentum-num">{momentum.unread7d}</div>
      <div class="momentum-label">Unread · 7d</div>
    </a>
    <a class="momentum-card is-link" href={data.momentumLinks?.highFitUnread7d ?? '/articles?read=unread&sort=unread_first&sinceDays=7&score=5&score=4&score=3'}>
      <div class="momentum-num">{momentum.highFitUnread7d}</div>
      <div class="momentum-label">High fit · 7d</div>
    </a>
  </div>

  <div class="quick-links">
    <a href={data.queueConfig?.hrefUnread ?? '/articles?read=unread&sort=unread_first'}>Open unread queue</a>
    <a href={data.queueConfig?.hrefHighFitUnread ?? '/articles?read=unread&sort=unread_first&sinceDays=7&score=5&score=4&score=3'}>Open high-fit unread</a>
    <a href="/articles">Browse all articles</a>
  </div>
</section>

{#if !data.hasFeeds}
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
  .hero-utility {
    background: var(--surface);
    border-radius: var(--radius-xl);
    padding: var(--space-5) var(--space-6);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
  }

  h1 {
    font-size: 2.2rem;
    font-weight: 600;
    margin: 0 0 var(--space-2);
    line-height: 1.08;
  }

  .hero-desc {
    color: var(--muted-text);
    margin: 0;
    line-height: 1.5;
  }

  .pull-section {
    min-width: 260px;
    display: grid;
    gap: var(--space-2);
    justify-items: end;
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

  .reading-queue {
    background: var(--surface);
    border-radius: var(--radius-xl);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
  }

  .section-head h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
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
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .queue-grid {
    display: grid;
    gap: var(--space-4);
  }

  .queue-card {
    background: var(--surface-strong);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: grid;
    grid-template-columns: 180px 1fr;
  }

  .card-img-wrap {
    display: block;
    background: var(--surface-soft);
    height: 140px;
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
  }

  .card-title {
    font-weight: 650;
    color: var(--text-color);
    text-decoration: none;
    line-height: 1.34;
  }

  .card-title:hover {
    color: var(--primary);
  }

  .fit-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    color: var(--muted-text);
    padding: 0.26rem 0.58rem;
    font-size: 0.75rem;
    font-weight: 500;
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

  .reason-row {
    display: flex;
    align-items: center;
  }

  .reason-chip {
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    color: var(--muted-text);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    padding: 0.18rem 0.48rem;
  }

  .reason-chip.high {
    color: #86efac;
    background: rgba(134, 239, 172, 0.12);
  }

  .card-excerpt {
    margin: 0;
    color: var(--muted-text);
    line-height: 1.45;
    font-size: var(--text-sm);
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
    flex-wrap: wrap;
  }

  .card-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .open-link {
    font-size: var(--text-sm);
    color: var(--muted-text);
    text-decoration: none;
    padding: 0.35rem 0.5rem;
  }

  .open-link:hover {
    color: var(--text-color);
  }

  .mark-read {
    border: none;
    background: var(--surface-soft);
    color: var(--ghost-color);
    border-radius: var(--radius-full);
    padding: 0.35rem 0.75rem;
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .mark-read:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  .queue-empty {
    padding: var(--space-8) var(--space-2);
    color: var(--muted-text);
    display: grid;
    gap: var(--space-3);
  }

  .queue-empty p {
    margin: 0;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .empty-actions a,
  .empty-actions button {
    border: none;
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    color: var(--text-color);
    padding: 0.38rem 0.78rem;
    font-size: var(--text-sm);
    text-decoration: none;
    font-family: inherit;
  }

  .empty-actions button {
    cursor: pointer;
  }

  .momentum {
    background: var(--surface);
    border-radius: var(--radius-xl);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .momentum-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .momentum-card {
    background: var(--surface-strong);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    text-align: center;
  }

  .momentum-card.is-link {
    text-decoration: none;
    color: inherit;
    transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .momentum-card.is-link:hover {
    box-shadow: var(--shadow-md);
  }

  .momentum-num {
    font-size: 1.7rem;
    line-height: 1;
    font-weight: 600;
    color: var(--primary);
  }

  .momentum-label {
    margin-top: var(--space-1);
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  .quick-links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .quick-links a {
    border: none;
    background: var(--surface-soft);
    border-radius: var(--radius-full);
    padding: 0.35rem 0.78rem;
    text-decoration: none;
    font-size: var(--text-sm);
  }

  :global(.card) ul {
    padding-left: 1.2rem;
    margin: 0;
  }

  :global(.card) h3 {
    margin: 0;
  }

  @media (max-width: 940px) {
    .hero-utility {
      flex-direction: column;
      align-items: flex-start;
    }

    .pull-section {
      justify-items: start;
      min-width: 0;
    }

    .queue-card {
      grid-template-columns: 1fr;
    }

    .card-img-wrap {
      height: 180px;
    }

    .momentum-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    h1 {
      font-size: 1.85rem;
    }

    .momentum-grid {
      grid-template-columns: 1fr 1fr;
    }

    .card-actions {
      justify-content: flex-start;
    }
  }
</style>
