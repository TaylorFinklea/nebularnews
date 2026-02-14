<script>
  import { invalidateAll } from '$app/navigation';
  import {
    IconBan,
    IconClockPlay,
    IconPlayerPlay,
    IconPlaylistAdd,
    IconRepeat,
    IconTrash
  } from '$lib/icons';

  export let data;

  const filters = ['pending', 'running', 'failed', 'done', 'cancelled', 'all'];
  let busyKey = '';
  let message = '';

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
    message = '';
    try {
      const res = await fetch('/api/jobs', {
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
        message = payload?.error ?? `${label} failed`;
        return;
      }

      const touched = payload?.updated ?? payload?.deleted;
      if (action === 'run_queue') {
        message = `Queue ran ${payload.cycles} cycle${payload.cycles === 1 ? '' : 's'}. Pending: ${payload.counts.pending}, running: ${payload.counts.running}, failed: ${payload.counts.failed}.`;
      } else if (action === 'queue_today_missing') {
        const summarizeQueued = payload?.queued?.summarizeQueued ?? 0;
        const scoreQueued = payload?.queued?.scoreQueued ?? 0;
        const autoTagQueued = payload?.queued?.autoTagQueued ?? 0;
        if (summarizeQueued === 0 && scoreQueued === 0 && autoTagQueued === 0) {
          const label = payload?.queued?.dayStart ? new Date(payload.queued.dayStart).toLocaleDateString() : 'today';
          message = `No missing summarize/score/auto-tag jobs found for ${label}.`;
        } else {
          message = `Queued today's missing jobs: ${summarizeQueued} summarize, ${scoreQueued} score, ${autoTagQueued} auto-tag.`;
        }
      } else if (typeof touched === 'number') {
        message = `${label} updated ${touched} job${touched === 1 ? '' : 's'}.`;
      } else {
        message = `${label} completed.`;
      }
      await invalidateAll();
    } catch {
      message = `${label} failed`;
    } finally {
      busyKey = '';
    }
  };

  const isBusy = (action, jobId = null) => busyKey === `${action}:${jobId ?? 'all'}`;
</script>

<section class="page-header">
  <div>
    <h1>Job Queue</h1>
    <p>Inspect and control pending, failed, and completed jobs.</p>
  </div>
</section>

<div class="today-missing">
  <strong>Today missing:</strong>
  <span>{data.today.missingSummaries} summaries</span>
  <span>{data.today.missingScores} scores</span>
  <span>{data.today.missingAutoTags} auto-tags</span>
  <span>({formatUtcOffset(data.today.tzOffsetMinutes)})</span>
</div>

<div class="stats">
  <div class="stat">
    <strong>{data.counts.pending}</strong>
    <span>Pending</span>
  </div>
  <div class="stat">
    <strong>{data.counts.running}</strong>
    <span>Running</span>
  </div>
  <div class="stat">
    <strong>{data.counts.failed}</strong>
    <span>Failed</span>
  </div>
  <div class="stat">
    <strong>{data.counts.done}</strong>
    <span>Done</span>
  </div>
  <div class="stat">
    <strong>{data.counts.cancelled}</strong>
    <span>Cancelled</span>
  </div>
</div>

<div class="controls">
  <button
    class="icon-button"
    disabled={isBusy('run_queue')}
    on:click={() => runAction('run_queue', { label: 'Run queue', cycles: 2 })}
    title="Run queue now"
    aria-label="Run queue now"
  >
    <IconPlayerPlay size={20} stroke={2.2} />
    <span class="sr-only">Run queue now</span>
  </button>
  <button
    class="icon-button"
    disabled={isBusy('queue_today_missing')}
    on:click={() => runAction('queue_today_missing', { label: 'Queue today missing' })}
    title="Queue missing today jobs"
    aria-label="Queue missing today jobs"
  >
    <IconPlaylistAdd size={20} stroke={2.2} />
    <span class="sr-only">Queue missing today jobs</span>
  </button>
  <button
    class="ghost icon-button"
    disabled={isBusy('retry_failed')}
    on:click={() => runAction('retry_failed', { label: 'Retry failed' })}
    title="Retry failed jobs"
    aria-label="Retry failed jobs"
  >
    <IconRepeat size={20} stroke={2.2} />
    <span class="sr-only">Retry failed jobs</span>
  </button>
  <button
    class="ghost icon-button"
    disabled={isBusy('cancel_pending_all')}
    on:click={() => runAction('cancel_pending_all', { label: 'Cancel pending' })}
    title="Cancel pending jobs"
    aria-label="Cancel pending jobs"
  >
    <IconBan size={20} stroke={2.2} />
    <span class="sr-only">Cancel pending jobs</span>
  </button>
  <button
    class="ghost icon-button"
    disabled={isBusy('clear_finished')}
    on:click={() => runAction('clear_finished', { label: 'Clear finished' })}
    title="Clear finished jobs"
    aria-label="Clear finished jobs"
  >
    <IconTrash size={20} stroke={2.2} />
    <span class="sr-only">Clear finished jobs</span>
  </button>
</div>

{#if message}
  <p class="message">{message}</p>
{/if}

<div class="filters">
  {#each filters as filter}
    <a href={filter === 'all' ? '/jobs?status=all' : `/jobs?status=${filter}`} class:active={data.status === filter}>
      {filter}
    </a>
  {/each}
</div>

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
          <td colspan="8" class="muted">No jobs for this filter.</td>
        </tr>
      {:else}
        {#each data.jobs as job}
          <tr>
            <td>{job.type}</td>
            <td>
              {#if job.article_id}
                <a href={`/articles/${job.article_id}`}>{job.article_title ?? job.article_id}</a>
              {:else}
                <span class="muted">System</span>
              {/if}
            </td>
            <td>
              <span class={`status ${job.status}`}>{job.status}</span>
            </td>
            <td>
              {#if job.provider && job.model}
                <span>{job.provider}/{job.model}</span>
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td>{job.attempts}</td>
            <td>{new Date(job.run_after).toLocaleString()}</td>
            <td class="error">{job.last_error ?? '—'}</td>
            <td>
              <div class="actions">
                {#if job.status !== 'running'}
                  <button
                    class="ghost icon-button"
                    disabled={isBusy('run_now', job.id)}
                    on:click={() => runAction('run_now', { jobId: job.id, label: 'Run now' })}
                    title="Run job now"
                    aria-label="Run job now"
                  >
                    <IconClockPlay size={17} stroke={2.05} />
                    <span class="sr-only">Run job now</span>
                  </button>
                {/if}
                {#if job.status === 'pending'}
                  <button
                    class="ghost icon-button"
                    disabled={isBusy('cancel', job.id)}
                    on:click={() => runAction('cancel', { jobId: job.id, label: 'Cancel' })}
                    title="Cancel job"
                    aria-label="Cancel job"
                  >
                    <IconBan size={17} stroke={2.05} />
                    <span class="sr-only">Cancel job</span>
                  </button>
                {/if}
                {#if job.status !== 'running'}
                  <button
                    class="ghost icon-button"
                    disabled={isBusy('delete', job.id)}
                    on:click={() => runAction('delete', { jobId: job.id, label: 'Delete' })}
                    title="Delete job"
                    aria-label="Delete job"
                  >
                    <IconTrash size={17} stroke={2.05} />
                    <span class="sr-only">Delete job</span>
                  </button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .today-missing {
    margin-top: 0.8rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.8rem;
    margin-top: 1rem;
  }

  .stat {
    background: var(--surface);
    border-radius: 16px;
    padding: 0.8rem;
    box-shadow: 0 10px 22px var(--shadow-color);
    border: 1px solid var(--surface-border);
  }

  .stat strong {
    font-size: 1.4rem;
    display: block;
  }

  .stat span {
    color: var(--muted-text);
    font-size: 0.9rem;
  }

  .controls {
    margin-top: 1rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .controls button {
    border: none;
    border-radius: 999px;
    padding: 0.55rem 0.9rem;
    background: var(--button-bg);
    color: var(--button-text);
    cursor: pointer;
  }

  .icon-button {
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-button :global(svg) {
    width: 1.15rem;
    height: 1.15rem;
    display: block;
  }

  .controls .icon-button {
    width: 2.7rem;
    height: 2.7rem;
  }

  .controls .icon-button :global(svg) {
    width: 1.32rem;
    height: 1.32rem;
  }

  .controls .ghost,
  .actions .ghost {
    background: transparent;
    color: var(--ghost-color);
    border: 1px solid var(--ghost-border);
  }

  .controls button:disabled,
  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .message {
    margin-top: 0.8rem;
    color: var(--muted-text);
  }

  .filters {
    margin-top: 1.2rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .filters a {
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    background: var(--surface-soft);
    border: 1px solid var(--surface-border);
    text-transform: capitalize;
    font-size: 0.85rem;
  }

  .filters a.active {
    background: var(--primary-soft);
    border-color: var(--ghost-border);
  }

  .table-wrap {
    margin-top: 1rem;
    overflow-x: auto;
    background: var(--surface-strong);
    border-radius: 18px;
    box-shadow: 0 10px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 980px;
  }

  th,
  td {
    text-align: left;
    padding: 0.7rem 0.8rem;
    border-bottom: 1px solid var(--surface-border);
    vertical-align: top;
  }

  th {
    font-size: 0.85rem;
    color: var(--muted-text);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .error {
    max-width: 360px;
    color: var(--text-color);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .actions button {
    padding: 0;
    border-radius: 999px;
    cursor: pointer;
    width: 2.15rem;
    height: 2.15rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .actions button :global(svg) {
    width: 1.04rem;
    height: 1.04rem;
  }

  .status {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    text-transform: capitalize;
    font-size: 0.8rem;
  }

  .status.pending {
    background: var(--primary-soft);
    color: var(--primary);
  }

  .status.running {
    background: rgba(88, 174, 255, 0.2);
    color: #72c3ff;
  }

  .status.failed {
    background: rgba(255, 110, 150, 0.2);
    color: #ff9dbc;
  }

  .status.done {
    background: rgba(114, 236, 200, 0.18);
    color: #91f0cd;
  }

  .status.cancelled {
    background: rgba(130, 142, 190, 0.2);
    color: var(--muted-text);
  }

  .muted {
    color: var(--muted-text);
  }
</style>
