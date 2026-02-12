<script>
  import { invalidateAll } from '$app/navigation';

  export let data;

  const filters = ['pending', 'running', 'failed', 'done', 'cancelled', 'all'];
  let busyKey = '';
  let message = '';

  const runAction = async (action, options = {}) => {
    const { jobId = null, label = action, cycles = 1 } = options;
    busyKey = `${action}:${jobId ?? 'all'}`;
    message = '';
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, jobId, cycles, forceDue: action === 'run_queue' ? true : undefined })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        message = payload?.error ?? `${label} failed`;
        return;
      }

      const touched = payload?.updated ?? payload?.deleted;
      if (action === 'run_queue') {
        message = `Queue ran ${payload.cycles} cycle${payload.cycles === 1 ? '' : 's'}. Pending: ${payload.counts.pending}, running: ${payload.counts.running}, failed: ${payload.counts.failed}.`;
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
  <button disabled={isBusy('run_queue')} on:click={() => runAction('run_queue', { label: 'Run queue', cycles: 2 })}>
    Run queue now
  </button>
  <button
    class="ghost"
    disabled={isBusy('retry_failed')}
    on:click={() => runAction('retry_failed', { label: 'Retry failed' })}
  >
    Retry failed
  </button>
  <button
    class="ghost"
    disabled={isBusy('cancel_pending_all')}
    on:click={() => runAction('cancel_pending_all', { label: 'Cancel pending' })}
  >
    Cancel pending
  </button>
  <button
    class="ghost"
    disabled={isBusy('clear_finished')}
    on:click={() => runAction('clear_finished', { label: 'Clear finished' })}
  >
    Clear finished
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
                    class="ghost"
                    disabled={isBusy('run_now', job.id)}
                    on:click={() => runAction('run_now', { jobId: job.id, label: 'Run now' })}
                  >
                    Run now
                  </button>
                {/if}
                {#if job.status === 'pending'}
                  <button
                    class="ghost"
                    disabled={isBusy('cancel', job.id)}
                    on:click={() => runAction('cancel', { jobId: job.id, label: 'Cancel' })}
                  >
                    Cancel
                  </button>
                {/if}
                {#if job.status !== 'running'}
                  <button
                    class="ghost"
                    disabled={isBusy('delete', job.id)}
                    on:click={() => runAction('delete', { jobId: job.id, label: 'Delete' })}
                  >
                    Delete
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
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.8rem;
    margin-top: 1rem;
  }

  .stat {
    background: rgba(255, 255, 255, 0.9);
    border-radius: 16px;
    padding: 0.8rem;
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.08);
  }

  .stat strong {
    font-size: 1.4rem;
    display: block;
  }

  .stat span {
    color: rgba(0, 0, 0, 0.65);
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
    background: #1f1f1f;
    color: white;
    cursor: pointer;
  }

  .controls .ghost,
  .actions .ghost {
    background: transparent;
    color: #c55b2a;
    border: 1px solid rgba(197, 91, 42, 0.4);
  }

  .controls button:disabled,
  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .message {
    margin-top: 0.8rem;
    color: rgba(0, 0, 0, 0.72);
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
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(0, 0, 0, 0.08);
    text-transform: capitalize;
    font-size: 0.85rem;
  }

  .filters a.active {
    background: rgba(197, 91, 42, 0.2);
    border-color: rgba(197, 91, 42, 0.35);
  }

  .table-wrap {
    margin-top: 1rem;
    overflow-x: auto;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 18px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
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
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    vertical-align: top;
  }

  th {
    font-size: 0.85rem;
    color: rgba(0, 0, 0, 0.65);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .error {
    max-width: 360px;
    color: rgba(0, 0, 0, 0.7);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .actions button {
    padding: 0.35rem 0.65rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .status {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    text-transform: capitalize;
    font-size: 0.8rem;
  }

  .status.pending {
    background: rgba(197, 91, 42, 0.15);
    color: #c55b2a;
  }

  .status.running {
    background: rgba(63, 121, 186, 0.16);
    color: #244e7e;
  }

  .status.failed {
    background: rgba(185, 48, 48, 0.15);
    color: #7f2323;
  }

  .status.done {
    background: rgba(44, 128, 76, 0.14);
    color: #1f5e36;
  }

  .status.cancelled {
    background: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.75);
  }

  .muted {
    color: rgba(0, 0, 0, 0.55);
  }
</style>
