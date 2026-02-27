<script>
  export let draft;
  export let ranges;
  export let onSetField;
</script>

<div class="card" id="behavior">
  <h2>Behavior defaults</h2>
  <label>
    Summary style
    <select value={draft.summaryStyle} on:change={(event) => onSetField('summaryStyle', event.currentTarget.value)}>
      <option value="concise">Concise</option>
      <option value="detailed">Detailed</option>
      <option value="bullet">Bullet-heavy</option>
    </select>
  </label>
  <label>
    Summary length
    <select value={draft.summaryLength} on:change={(event) => onSetField('summaryLength', event.currentTarget.value)}>
      <option value="short">Short</option>
      <option value="medium">Medium</option>
      <option value="long">Long</option>
    </select>
  </label>
  <label>
    Initial feed backfill window (days)
    <input
      type="number"
      min={ranges.initialFeedLookback.min}
      max={ranges.initialFeedLookback.max}
      step="1"
      value={draft.initialFeedLookbackDays}
      on:input={(event) => onSetField('initialFeedLookbackDays', Number(event.currentTarget.value))}
    />
  </label>
  <p class="muted">
    Applies to first-time feed pulls and newly added feeds. Default {ranges.initialFeedLookback.default} days.
    Set to 0 to include all available history.
  </p>
  <label>
    Retention window (days)
    <input
      type="number"
      min={ranges.retention.min}
      max={ranges.retention.max}
      step="1"
      value={draft.retentionDays}
      on:input={(event) => onSetField('retentionDays', Number(event.currentTarget.value))}
    />
  </label>
  <div class="field">
    <div class="field-label">Retention mode</div>
    <div class="lane-toggle" role="radiogroup" aria-label="Retention mode">
      <label class:active={draft.retentionMode === 'archive'}>
        <input type="radio" name="retentionMode" value="archive" checked={draft.retentionMode === 'archive'} on:change={() => onSetField('retentionMode', 'archive')} />
        <span>Archive text</span>
      </label>
      <label class:active={draft.retentionMode === 'delete'}>
        <input type="radio" name="retentionMode" value="delete" checked={draft.retentionMode === 'delete'} on:change={() => onSetField('retentionMode', 'delete')} />
        <span>Delete records</span>
      </label>
    </div>
  </div>
  <p class="muted">
    Daily cleanup runs at 03:30 UTC. 0 days disables cleanup. Archive mode strips article body text; delete mode removes old articles.
  </p>
  <label>
    Mark article as read after (ms)
    <input
      type="number"
      min={ranges.autoReadDelay.min}
      max={ranges.autoReadDelay.max}
      step="250"
      value={draft.autoReadDelayMs}
      on:input={(event) => onSetField('autoReadDelayMs', Number(event.currentTarget.value))}
    />
  </label>
  <p class="muted">
    Applies on article detail pages. Current delay: {(Number(draft.autoReadDelayMs) / 1000).toFixed(2)}s. 0 means immediate. Range {ranges.autoReadDelay.min}-{ranges.autoReadDelay.max} ms.
  </p>
  <label>
    Job processor batch size
    <input
      type="number"
      min={ranges.jobBatch.min}
      max={ranges.jobBatch.max}
      step="1"
      value={draft.jobProcessorBatchSize}
      on:input={(event) => onSetField('jobProcessorBatchSize', Number(event.currentTarget.value))}
    />
  </label>
  <p class="muted">
    Controls how many jobs each processor sweep can claim in batch-v2 mode.
  </p>
  <div class="field">
    <div class="field-label">Articles card layout</div>
    <div class="lane-toggle" role="radiogroup" aria-label="Articles card layout">
      <label class:active={draft.articleCardLayout === 'split'}>
        <input type="radio" name="articleCardLayout" value="split" checked={draft.articleCardLayout === 'split'} on:change={() => onSetField('articleCardLayout', 'split')} />
        <span>Split (1)</span>
      </label>
      <label class:active={draft.articleCardLayout === 'stacked'}>
        <input type="radio" name="articleCardLayout" value="stacked" checked={draft.articleCardLayout === 'stacked'} on:change={() => onSetField('articleCardLayout', 'stacked')} />
        <span>Stacked (2)</span>
      </label>
    </div>
  </div>
  <label>
    Dashboard queue window (days)
    <input
      type="number"
      min={ranges.dashboardQueue.windowDays.min}
      max={ranges.dashboardQueue.windowDays.max}
      step="1"
      value={draft.dashboardQueueWindowDays}
      on:input={(event) => onSetField('dashboardQueueWindowDays', Number(event.currentTarget.value))}
    />
  </label>
  <label>
    Dashboard queue count
    <input
      type="number"
      min={ranges.dashboardQueue.limit.min}
      max={ranges.dashboardQueue.limit.max}
      step="1"
      value={draft.dashboardQueueLimit}
      on:input={(event) => onSetField('dashboardQueueLimit', Number(event.currentTarget.value))}
    />
  </label>
  <label>
    Dashboard high-fit cutoff (1-5)
    <input
      type="number"
      min={ranges.dashboardQueue.scoreCutoff.min}
      max={ranges.dashboardQueue.scoreCutoff.max}
      step="1"
      value={draft.dashboardQueueScoreCutoff}
      on:input={(event) => onSetField('dashboardQueueScoreCutoff', Number(event.currentTarget.value))}
    />
  </label>
  <p class="muted">
    Controls the dashboard's reading queue. Window range {ranges.dashboardQueue.windowDays.min}-{ranges.dashboardQueue.windowDays.max} days; count range {ranges.dashboardQueue.limit.min}-{ranges.dashboardQueue.limit.max}; cutoff range {ranges.dashboardQueue.scoreCutoff.min}-{ranges.dashboardQueue.scoreCutoff.max}.
  </p>
</div>

<style>
  .card {
    background: var(--surface-strong);
    padding: 1.8rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: 1rem;
    align-content: start;
    min-width: 0;
  }

  label {
    display: grid;
    gap: 0.45rem;
    font-size: 0.9rem;
    min-width: 0;
  }

  .field {
    display: grid;
    gap: 0.45rem;
    min-width: 0;
  }

  .field-label {
    font-size: 0.9rem;
  }

  input,
  select {
    width: 100%;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
    min-width: 0;
    max-width: 100%;
  }

  .muted {
    color: var(--muted-text);
    font-size: 0.85rem;
  }

  .lane-toggle {
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    border: 1px solid var(--input-border);
    border-radius: 999px;
    padding: 0.25rem;
    background: var(--surface-soft);
    max-width: 420px;
    width: 100%;
  }

  .lane-toggle label {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0.45rem 0.8rem;
    cursor: pointer;
    font-weight: 600;
    color: var(--muted-text);
    transition: background 0.15s ease, color 0.15s ease;
  }

  .lane-toggle label.active {
    background: var(--button-bg);
    color: var(--button-text);
  }

  .lane-toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 1px;
    height: 1px;
  }

  @media (max-width: 900px) {
    .card {
      padding: 1.25rem;
    }
  }
</style>
