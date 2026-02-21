<script>
  import { invalidate } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { liveEvents, startLiveEvents } from '$lib/client/live-events';
  import {
    IconBan,
    IconClockPlay,
    IconPlayerPlay,
    IconPlaylistAdd,
    IconRepeat,
    IconTrash
  } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import Pill from '$lib/components/Pill.svelte';
  import { showToast } from '$lib/client/toast';

  export let data;

  const filters = ['pending', 'running', 'failed', 'done', 'cancelled', 'all'];
  const LIVE_REFRESH_DEBOUNCE_MS = 600;
  let busyKey = '';
  let liveCounts = null;
  let liveConnected = false;
  let liveUnsubscribe = () => {};
  let stopLiveEvents = () => {};
  let refreshTimer = null;
  let lastLiveSignature = '';

  $: displayCounts = {
    ...data.counts,
    ...(liveCounts
      ? { pending: liveCounts.pending, running: liveCounts.running, failed: liveCounts.failed, done: liveCounts.done }
      : {})
  };

  const scheduleJobsRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      await invalidate('app:jobs');
    }, LIVE_REFRESH_DEBOUNCE_MS);
  };

  onMount(() => {
    stopLiveEvents = startLiveEvents();
    liveUnsubscribe = liveEvents.subscribe((snapshot) => {
      liveConnected = snapshot.connected;
      if (!snapshot.jobs) return;
      liveCounts = snapshot.jobs;
      const signature = `${snapshot.jobs.pending}:${snapshot.jobs.running}:${snapshot.jobs.failed}:${snapshot.jobs.done}`;
      if (signature === lastLiveSignature) return;
      lastLiveSignature = signature;
      scheduleJobsRefresh();
    });
  });

  onDestroy(() => {
    liveUnsubscribe();
    stopLiveEvents();
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  });

  const formatUtcOffset = (offsetMinutes) => {
    const normalized = Number(offsetMinutes ?? 0);
    const sign = normalized <= 0 ? '+' : '-';
    const absolute = Math.abs(normalized);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const minutes = String(absolute % 60).padStart(2, '0');
    return `UTC${sign}${hours}:${minutes}`;
  };

  const runAction = async (action, options = {}) => {
    const { jobId = null, label = action, cycles = 1 } = options;
    busyKey = `${action}:${jobId ?? 'all'}`;
    try {
      const res = await apiFetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          jobId,
          cycles,
          forceDue: action === 'run_queue' ? true : undefined,
          tzOffsetMinutes: action === 'queue_today_missing' ? new Date().getTimezoneOffset() : undefined
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload?.error ?? `${label} failed`, 'error');
        return;
      }

      let msg = `${label} completed.`;
      const touched = payload?.updated ?? payload?.deleted;
      if (action === 'run_queue') {
        msg = `Queue ran ${payload.cycles} cycle${payload.cycles === 1 ? '' : 's'}. Pending: ${payload.counts.pending}, running: ${payload.counts.running}, failed: ${payload.counts.failed}.`;
      } else if (action === 'queue_today_missing') {
        const s = payload?.queued?.summarizeQueued ?? 0;
        const sc = payload?.queued?.scoreQueued ?? 0;
        const at = payload?.queued?.autoTagQueued ?? 0;
        msg = (s === 0 && sc === 0 && at === 0)
          ? `No missing jobs found for today.`
          : `Queued: ${s} summarize, ${sc} score, ${at} auto-tag.`;
      } else if (typeof touched === 'number') {
        msg = `${label} updated ${touched} job${touched === 1 ? '' : 's'}.`;
      }
      showToast(msg, 'success');
      await invalidate('app:jobs');
    } catch {
      showToast(`${label} failed`, 'error');
    } finally {
      busyKey = '';
    }
  };

  const isBusy = (action, jobId = null) => busyKey === `${action}:${jobId ?? 'all'}`;

  const statusVariant = (status) => {
    if (status === 'pending') return 'default';
    if (status === 'running') return 'running';
    if (status === 'failed') return 'warning';
    if (status === 'done') return 'success';
    if (status === 'cancelled') return 'cancelled';
    return 'muted';
  };
</script>

<PageHeader title="Job Queue" description="Inspect and control pending, failed, and completed jobs.">
  <svelte:fragment slot="subnav">
    <span class="live-status" class:connected={liveConnected}>
      {liveConnected ? '● Live' : '○ Reconnecting...'}
    </span>
  </svelte:fragment>
</PageHeader>

<!-- Stats row -->
<div class="stats-row">
  <Card variant="soft">
    <div class="stat-val">{displayCounts.pending}</div>
    <div class="stat-label">Pending</div>
  </Card>
  <Card variant="soft">
    <div class="stat-val running">{displayCounts.running}</div>
    <div class="stat-label">Running</div>
  </Card>
  <Card variant="soft">
    <div class="stat-val failed">{displayCounts.failed}</div>
    <div class="stat-label">Failed</div>
  </Card>
  <Card variant="soft">
    <div class="stat-val done">{displayCounts.done}</div>
    <div class="stat-label">Done</div>
  </Card>
  <Card variant="soft">
    <div class="stat-val">{data.counts.cancelled}</div>
    <div class="stat-label">Cancelled</div>
  </Card>
</div>

<!-- Today missing -->
<div class="today-missing">
  <strong>Today missing:</strong>
  <span>{data.today.missingSummaries} summaries</span>
  <span>{data.today.missingScores} scores</span>
  <span>{data.today.missingAutoTags} auto-tags</span>
  <span class="tz">({formatUtcOffset(data.today.tzOffsetMinutes)})</span>
</div>

<!-- Controls -->
<div class="controls">
  <Button
    variant="primary"
    size="inline"
    disabled={isBusy('run_queue')}
    on:click={() => runAction('run_queue', { label: 'Run queue', cycles: 2 })}
    title="Run queue now"
  >
    <IconPlayerPlay size={16} stroke={2} />
    <span>Run queue</span>
  </Button>
  <Button
    variant="primary"
    size="inline"
    disabled={isBusy('queue_today_missing')}
    on:click={() => runAction('queue_today_missing', { label: 'Queue today missing' })}
    title="Queue missing today jobs"
  >
    <IconPlaylistAdd size={16} stroke={2} />
    <span>Queue missing</span>
  </Button>
  <Button
    variant="ghost"
    size="inline"
    disabled={isBusy('retry_failed')}
    on:click={() => runAction('retry_failed', { label: 'Retry failed' })}
    title="Retry failed jobs"
  >
    <IconRepeat size={16} stroke={2} />
    <span>Retry failed</span>
  </Button>
  <Button
    variant="ghost"
    size="inline"
    disabled={isBusy('cancel_pending_all')}
    on:click={() => runAction('cancel_pending_all', { label: 'Cancel pending' })}
    title="Cancel all pending jobs"
  >
    <IconBan size={16} stroke={2} />
    <span>Cancel pending</span>
  </Button>
  <Button
    variant="ghost"
    size="inline"
    disabled={isBusy('clear_finished')}
    on:click={() => runAction('clear_finished', { label: 'Clear finished' })}
    title="Clear finished jobs"
  >
    <IconTrash size={16} stroke={2} />
    <span>Clear finished</span>
  </Button>
</div>

<!-- Filter tabs -->
<div class="filter-tabs">
  {#each filters as filter}
    <a
      href={filter === 'all' ? '/jobs?status=all' : `/jobs?status=${filter}`}
      class="filter-tab"
      class:active={data.status === filter}
    >
      {filter}
      {#if filter !== 'all' && displayCounts[filter] != null}
        <span class="filter-count">{displayCounts[filter]}</span>
      {/if}
    </a>
  {/each}
</div>

<!-- Jobs table -->
<Card>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Article</th>
          <th>Status</th>
          <th>Model</th>
          <th>Attempts</th>
          <th>Run after</th>
          <th>Error</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#if data.jobs.length === 0}
          <tr>
            <td colspan="8" class="empty-cell">No jobs for this filter.</td>
          </tr>
        {:else}
          {#each data.jobs as job}
            <tr>
              <td class="mono">{job.type}</td>
              <td>
                {#if job.article_id}
                  <a href={`/articles/${job.article_id}`}>{job.article_title ?? job.article_id}</a>
                {:else}
                  <span class="muted">System</span>
                {/if}
              </td>
              <td>
                <Pill variant={statusVariant(job.status)}>{job.status}</Pill>
              </td>
              <td class="mono">
                {#if job.provider && job.model}
                  {job.provider}/{job.model}
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td>{job.attempts}</td>
              <td class="nowrap">{new Date(job.run_after).toLocaleString()}</td>
              <td class="error-cell">{job.last_error ?? '—'}</td>
              <td>
                <div class="row-actions">
                  {#if job.status !== 'running'}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isBusy('run_now', job.id)}
                      on:click={() => runAction('run_now', { jobId: job.id, label: 'Run now' })}
                      title="Run job now"
                    >
                      <IconClockPlay size={15} stroke={2} />
                    </Button>
                  {/if}
                  {#if job.status === 'pending'}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isBusy('cancel', job.id)}
                      on:click={() => runAction('cancel', { jobId: job.id, label: 'Cancel' })}
                      title="Cancel job"
                    >
                      <IconBan size={15} stroke={2} />
                    </Button>
                  {/if}
                  {#if job.status !== 'running'}
                    <Button
                      variant="danger"
                      size="icon"
                      disabled={isBusy('delete', job.id)}
                      on:click={() => runAction('delete', { jobId: job.id, label: 'Delete' })}
                      title="Delete job"
                    >
                      <IconTrash size={15} stroke={2} />
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</Card>

<style>
  .stats-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .stats-row :global(.card) {
    gap: var(--space-1);
    padding: var(--space-4);
    text-align: center;
  }

  .stat-val {
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--primary);
    line-height: 1;
  }

  .stat-val.running { color: #72c3ff; }
  .stat-val.failed  { color: #ff9dbc; }
  .stat-val.done    { color: #91f0cd; }

  .stat-label {
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 500;
  }

  .today-missing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
    color: var(--muted-text);
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
  }

  .today-missing strong {
    color: var(--text-color);
  }

  .tz {
    opacity: 0.7;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .filter-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }

  .filter-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.75rem;
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    border: 1px solid var(--surface-border);
    text-transform: capitalize;
    font-size: var(--text-sm);
    color: var(--muted-text);
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .filter-tab.active {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
    color: var(--primary);
    font-weight: 600;
  }

  .filter-count {
    background: var(--surface-strong);
    border-radius: var(--radius-full);
    padding: 0 0.35rem;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .live-status {
    font-size: var(--text-sm);
    color: var(--muted-text);
    margin-top: var(--space-1);
    display: block;
  }

  .live-status.connected {
    color: #91f0cd;
  }

  .table-wrap {
    overflow-x: auto;
    margin: calc(var(--space-4) * -1);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 980px;
  }

  th, td {
    text-align: left;
    padding: 0.7rem var(--space-4);
    border-bottom: 1px solid var(--surface-border);
    vertical-align: middle;
  }

  tr:last-child td {
    border-bottom: none;
  }

  th {
    font-size: var(--text-xs);
    color: var(--muted-text);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    background: var(--surface-soft);
  }

  .mono { font-family: monospace; font-size: var(--text-sm); }
  .nowrap { white-space: nowrap; font-size: var(--text-sm); color: var(--muted-text); }
  .muted { color: var(--muted-text); }

  .error-cell {
    max-width: 300px;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .empty-cell {
    color: var(--muted-text);
    text-align: center;
    padding: var(--space-8);
  }

  .row-actions {
    display: flex;
    gap: 0.3rem;
  }

  @media (max-width: 800px) {
    .stats-row {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
