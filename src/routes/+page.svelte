<script>
  import { invalidate } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { showToast } from '$lib/client/toast';
  import { getFitScoreAria, getFitScoreText, getFitScoreTone } from '$lib/fit-score';
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

  const queueArticleHref = (articleId) => {
    const from = data.queueConfig?.fromHref ?? '/articles';
    return `/articles/${articleId}?from=${encodeURIComponent(from)}`;
  };

  const newsBriefArticleHref = (articleId) => `/articles/${articleId}?from=${encodeURIComponent('/')}`;

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

  const relativeTime = (article) => {
    const value = article.published_at ?? article.fetched_at;
    if (!value) return '';
    const diff = Date.now() - new Date(value).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  $: heroArticle = queueItems.length > 0 ? queueItems[0] : null;
  $: restOfQueue = queueItems.length > 1 ? queueItems.slice(1) : [];

  const formatDateTime = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
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
    const pullEndpoint = data.isDev ? '/api/dev/pull' : '/api/pull';

    try {
      const res = await apiFetch(pullEndpoint, {
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

<!-- 1. Stat pills (momentum) -->
<section class="stat-pills">
  <div class="pills-row">
    <a class="pill" href={data.momentumLinks?.unreadTotal ?? '/articles?read=unread&sort=unread_first'}>
      <span class="pill-num">{momentum.unreadTotal}</span>
      <span class="pill-label">Unread total</span>
    </a>
    <a class="pill" href={data.momentumLinks?.unread24h ?? '/articles?read=unread&sort=unread_first&sinceDays=1'}>
      <span class="pill-num">{momentum.unread24h}</span>
      <span class="pill-label">Last 24h</span>
    </a>
    <a class="pill" href={data.momentumLinks?.unread7d ?? '/articles?read=unread&sort=unread_first&sinceDays=7'}>
      <span class="pill-num">{momentum.unread7d}</span>
      <span class="pill-label">Unread 7d</span>
    </a>
    <a class="pill" href={data.momentumLinks?.highFitUnread7d ?? '/articles?read=unread&sort=unread_first&sinceDays=7&score=5&score=4&score=3'}>
      <span class="pill-num">{momentum.highFitUnread7d}</span>
      <span class="pill-label">High fit 7d</span>
    </a>
  </div>
</section>

<!-- 2. Hero card (first queue article) -->
{#if heroArticle}
  <section class="hero-card-section">
    <a class="hero-card" href={queueArticleHref(heroArticle.id)}>
      <img
        class="hero-card-img"
        src={resolveArticleImageUrl(heroArticle)}
        alt=""
        loading="eager"
        decoding="async"
      />
      <div class="hero-card-overlay">
        <span
          class={`fit-pill ${getFitScoreTone(heroArticle.score, heroArticle.score_status)}`}
          title={getFitScoreAria(heroArticle.score, heroArticle.score_status)}
          aria-label={getFitScoreAria(heroArticle.score, heroArticle.score_status)}
        >
          <IconStars size={13} stroke={1.9} />
          <span>{getFitScoreText(heroArticle.score, heroArticle.score_status)}</span>
        </span>
        <h2 class="hero-card-title">{heroArticle.title ?? 'Untitled article'}</h2>
        <span class="hero-card-source">{heroArticle.source_name ?? 'Unknown source'}</span>
      </div>
    </a>
  </section>
{/if}

<!-- 3. News Brief -->
{#if data.newsBrief}
  <section class="news-brief">
    <div class="section-head">
      <div>
        <div class="news-brief-heading-row">
          <h2>{data.newsBrief.title}</h2>
          {#if data.newsBrief.stale}
            <span class="news-brief-badge">Stale</span>
          {/if}
        </div>
        <p class="section-cap">
          {data.newsBrief.editionLabel} · Last {data.newsBrief.windowHours} hours · {data.newsBrief.scoreCutoff}+ fit
          {#if data.newsBrief.generatedAt}
            · Updated {formatDateTime(data.newsBrief.generatedAt)}
          {/if}
        </p>
      </div>
      <a href="/settings#reading" class="view-all">
        <IconExternalLink size={13} stroke={1.9} />
        <span>Configure</span>
      </a>
    </div>

    {#if data.newsBrief.state === 'ready'}
      <ul class="news-brief-list">
        {#each data.newsBrief.bullets as bullet}
          <li class="news-brief-item">
            <p class="news-brief-text">{bullet.text}</p>
            <div class="news-brief-sources">
              {#each bullet.sources as source}
                <a class="news-brief-source" href={newsBriefArticleHref(source.articleId)}>
                  {source.title}
                </a>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    {:else if data.newsBrief.state === 'empty'}
      <div class="news-brief-empty">
        <p>No high-fit developments in the last {data.newsBrief.windowHours} hours.</p>
      </div>
    {:else if data.newsBrief.state === 'pending'}
      <div class="news-brief-empty">
        <p>The next News Brief is being generated.</p>
        {#if data.newsBrief.nextScheduledAt}
          <p class="muted-text">Next scheduled slot: {formatDateTime(data.newsBrief.nextScheduledAt)}</p>
        {/if}
      </div>
    {:else}
      <div class="news-brief-empty">
        <p>News Brief will appear here once AI briefing is configured and generated.</p>
        {#if data.newsBrief.nextScheduledAt}
          <p class="muted-text">Next scheduled slot: {formatDateTime(data.newsBrief.nextScheduledAt)}</p>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<!-- 4. Up Next rows (remaining queue articles) -->
<section class="reading-queue">
  <div class="section-head">
    <h2>Up Next · Last {data.queueConfig?.windowDays ?? 7} Days</h2>
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
    <div class="queue-rows">
      {#each restOfQueue as article}
        <article class="queue-row">
          <div class="accent-bar {getFitScoreTone(article.score, article.score_status)}"></div>
          <div class="row-body">
            <a class="row-title" href={queueArticleHref(article.id)}>{article.title ?? 'Untitled article'}</a>
            <div class="row-meta">
              <span>{article.source_name ?? 'Unknown source'}</span>
              <span
                class={`fit-pill ${getFitScoreTone(article.score, article.score_status)}`}
                title={getFitScoreAria(article.score, article.score_status)}
                aria-label={getFitScoreAria(article.score, article.score_status)}
              >
                <IconStars size={13} stroke={1.9} />
                <span>{getFitScoreText(article.score, article.score_status)}</span>
              </span>
              <span class="row-time">{relativeTime(article)}</span>
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

<!-- 5. Pull feeds utility -->
<section class="pull-utility">
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

{#if !data.hasFeeds}
  <Card variant="default">
    <h3>Get started</h3>
    <p>Pick feeds from our curated collection to start reading.</p>
    <a href="/onboarding"><Button>Choose feeds</Button></a>
  </Card>
{/if}

<style>
  /* ── Stat Pills ── */
  .stat-pills {
    margin-bottom: var(--space-6);
  }

  .pills-row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--surface-strong);
    border-radius: var(--radius-xl);
    padding: var(--space-3) var(--space-5);
    border: 1px solid var(--surface-border);
    text-decoration: none;
    color: inherit;
    flex: 1 1 0;
    min-width: 100px;
    transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .pill:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
    border-color: var(--surface-border-hover);
  }

  .pill:nth-child(1) .pill-num { color: var(--primary); }
  .pill:nth-child(2) .pill-num { color: var(--accent); }
  .pill:nth-child(3) .pill-num { color: #e8a060; }
  .pill:nth-child(4) .pill-num { color: #7aded0; }

  .pill-num {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;
  }

  .pill-label {
    font-size: 0.8rem;
    color: var(--muted-text);
    margin-top: 0.25rem;
  }

  /* ── Hero Card ── */
  .hero-card-section {
    margin-bottom: var(--space-6);
  }

  .hero-card {
    display: block;
    position: relative;
    border-radius: var(--radius-xl);
    overflow: hidden;
    text-decoration: none;
    color: #fff;
    height: 320px;
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
  }

  .hero-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .hero-card-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .hero-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.75) 100%);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: var(--space-6);
    gap: var(--space-2);
  }

  .hero-card-title {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1.25;
    color: #fff;
  }

  .hero-card-source {
    font-size: var(--text-sm);
    opacity: 0.8;
  }

  /* ── News Brief ── */
  .news-brief {
    background: var(--surface);
    border-radius: var(--radius-xl);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
    border-left: 3px solid var(--accent);
  }

  .news-brief-heading-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .news-brief-badge {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-sm);
    padding: 0.18rem 0.45rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: #f6d28b;
    background: rgba(246, 210, 139, 0.12);
  }

  .news-brief-list {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .news-brief-item {
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-strong);
  }

  .news-brief-text {
    margin: 0;
    font-size: var(--text-base);
    line-height: 1.5;
    color: var(--text-color);
  }

  .news-brief-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: var(--space-3);
  }

  .news-brief-source {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-sm);
    padding: 0.3rem 0.55rem;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  .news-brief-source:hover {
    color: var(--text-color);
  }

  .news-brief-empty {
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    background: var(--surface-strong);
  }

  .news-brief-empty p {
    margin: 0;
    color: var(--text-color);
    line-height: 1.5;
  }

  .news-brief-empty .muted-text {
    margin-top: var(--space-2);
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  /* ── Reading Queue (Up Next) ── */
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
    color: var(--muted-text);
    font-size: var(--text-sm);
  }

  /* ── Queue Rows (compact) ── */
  .queue-rows {
    display: grid;
    gap: var(--space-2);
  }

  .queue-row {
    display: flex;
    align-items: stretch;
    background: var(--surface-strong);
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid var(--surface-border);
    transition: border-color var(--transition-fast);
  }

  .queue-row:hover {
    border-color: var(--surface-border-hover);
  }

  .accent-bar {
    width: 4px;
    flex-shrink: 0;
    background: var(--muted-text);
  }
  .accent-bar.fit-1 { background: #fca5a5; }
  .accent-bar.fit-2 { background: #fdba74; }
  .accent-bar.fit-3 { background: #c4b5fd; }
  .accent-bar.fit-4 { background: #67e8f9; }
  .accent-bar.fit-5 { background: #86efac; }
  .accent-bar.fit-none,
  .accent-bar.fit-learning { background: var(--muted-text); }

  .row-body {
    flex: 1;
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .row-title {
    font-weight: 600;
    color: var(--text-color);
    text-decoration: none;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .row-title:hover {
    color: var(--primary);
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted-text);
    flex-wrap: wrap;
  }

  .row-time {
    color: var(--muted-text);
  }

  /* ── Fit Pill ── */
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
    flex-shrink: 0;
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

  /* ── Mark Read ── */
  .mark-read {
    border: none;
    background: var(--surface-soft);
    color: var(--ghost-color);
    border-radius: var(--radius-md);
    padding: 0.25rem 0.6rem;
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    margin-left: auto;
  }

  .mark-read:disabled {
    opacity: 0.65;
    cursor: wait;
  }

  /* ── Queue Empty ── */
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
    border-radius: var(--radius-md);
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

  /* ── Pull Utility ── */
  .pull-utility {
    background: var(--surface);
    border-radius: var(--radius-xl);
    padding: var(--space-5) var(--space-6);
    margin-bottom: var(--space-6);
  }

  .pull-section {
    display: flex;
    align-items: center;
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
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .live-badge {
    font-size: var(--text-xs);
    color: var(--muted-text);
    margin-left: auto;
  }

  .live-badge.live {
    color: var(--accent);
  }

  /* ── Shared ── */
  :global(.card) ul {
    padding-left: 1.2rem;
    margin: 0;
  }

  :global(.card) h3 {
    margin: 0;
  }

  /* ── Responsive ── */
  @media (max-width: 940px) {
    .hero-card {
      height: 240px;
    }

    .hero-card-title {
      font-size: 1.3rem;
    }
  }

  @media (max-width: 560px) {
    .pills-row {
      gap: var(--space-2);
    }

    .pill {
      padding: var(--space-2) var(--space-3);
      min-width: 70px;
    }

    .pill-num {
      font-size: 1.2rem;
    }

    .hero-card {
      height: 200px;
    }

    .hero-card-title {
      font-size: 1.15rem;
    }

    .pull-section {
      flex-direction: column;
      align-items: flex-start;
    }

    .live-badge {
      margin-left: 0;
    }
  }
</style>
