<script>
  export let draft;
  export let openaiModels = [];
  export let anthropicModels = [];
  export let onSetField;
  export let onSyncModels;
  export let modelStatus;
  export let isLoadingModels;
</script>

<div class="card" id="models">
  <h2>AI settings</h2>
  <h3>Feature routing</h3>
  <p class="muted">
    Set the model lane per AI feature.
  </p>
  <div class="feature-lanes">
    <div class="feature-lane">
      <div class="feature-name">Summaries</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Summaries model lane">
        <label class:active={draft.laneSummaries === 'model_a'}>
          <input type="radio" name="laneSummaries" value="model_a" checked={draft.laneSummaries === 'model_a'} on:change={() => onSetField('laneSummaries', 'model_a')} />
          <span>Model A</span>
        </label>
        <label class:active={draft.laneSummaries === 'model_b'}>
          <input type="radio" name="laneSummaries" value="model_b" checked={draft.laneSummaries === 'model_b'} on:change={() => onSetField('laneSummaries', 'model_b')} />
          <span>Model B</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Key Points</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Key points model lane">
        <label class:active={draft.laneKeyPoints === 'model_a'}>
          <input type="radio" name="laneKeyPoints" value="model_a" checked={draft.laneKeyPoints === 'model_a'} on:change={() => onSetField('laneKeyPoints', 'model_a')} />
          <span>Model A</span>
        </label>
        <label class:active={draft.laneKeyPoints === 'model_b'}>
          <input type="radio" name="laneKeyPoints" value="model_b" checked={draft.laneKeyPoints === 'model_b'} on:change={() => onSetField('laneKeyPoints', 'model_b')} />
          <span>Model B</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Auto Tagging</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Auto tagging model lane">
        <label class:active={draft.laneAutoTagging === 'model_a'}>
          <input type="radio" name="laneAutoTagging" value="model_a" checked={draft.laneAutoTagging === 'model_a'} on:change={() => onSetField('laneAutoTagging', 'model_a')} />
          <span>Model A</span>
        </label>
        <label class:active={draft.laneAutoTagging === 'model_b'}>
          <input type="radio" name="laneAutoTagging" value="model_b" checked={draft.laneAutoTagging === 'model_b'} on:change={() => onSetField('laneAutoTagging', 'model_b')} />
          <span>Model B</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Scoring</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Scoring model lane">
        <label class:active={draft.laneScoring === 'model_a'}>
          <input type="radio" name="laneScoring" value="model_a" checked={draft.laneScoring === 'model_a'} on:change={() => onSetField('laneScoring', 'model_a')} />
          <span>Model A</span>
        </label>
        <label class:active={draft.laneScoring === 'model_b'}>
          <input type="radio" name="laneScoring" value="model_b" checked={draft.laneScoring === 'model_b'} on:change={() => onSetField('laneScoring', 'model_b')} />
          <span>Model B</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Profile Refresh</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Profile refresh model lane">
        <label class:active={draft.laneProfileRefresh === 'model_a'}>
          <input type="radio" name="laneProfileRefresh" value="model_a" checked={draft.laneProfileRefresh === 'model_a'} on:change={() => onSetField('laneProfileRefresh', 'model_a')} />
          <span>Model A</span>
        </label>
        <label class:active={draft.laneProfileRefresh === 'model_b'}>
          <input type="radio" name="laneProfileRefresh" value="model_b" checked={draft.laneProfileRefresh === 'model_b'} on:change={() => onSetField('laneProfileRefresh', 'model_b')} />
          <span>Model B</span>
        </label>
      </div>
    </div>

  </div>

  <div class="model-sections">
    <section class="model-section" aria-label="Model A settings">
      <h3>Model A (cheaper)</h3>
      <label>
        Provider
        <select value={draft.modelAProvider} on:change={(event) => onSetField('modelAProvider', event.currentTarget.value)}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <label>
        Model
        <input
          value={draft.modelAModel}
          on:input={(event) => onSetField('modelAModel', event.currentTarget.value)}
          placeholder="gpt-5-mini"
          list={draft.modelAProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
        />
      </label>
      <div class="model-tools">
        <button class="ghost" on:click={() => onSyncModels(draft.modelAProvider)} disabled={isLoadingModels(draft.modelAProvider)}>
          <span>{isLoadingModels(draft.modelAProvider) ? 'Loading...' : `Refresh ${draft.modelAProvider}`}</span>
        </button>
        <p class="muted">{modelStatus(draft.modelAProvider)}</p>
      </div>
      <label>
        Reasoning level
        <select value={draft.modelAReasoningEffort} on:change={(event) => onSetField('modelAReasoningEffort', event.currentTarget.value)}>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
    </section>

    <section class="model-section" aria-label="Model B settings">
      <h3>Model B (more capable)</h3>
      <label>
        Provider
        <select value={draft.modelBProvider} on:change={(event) => onSetField('modelBProvider', event.currentTarget.value)}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <label>
        Model
        <input
          value={draft.modelBModel}
          on:input={(event) => onSetField('modelBModel', event.currentTarget.value)}
          placeholder="gpt-5.2"
          list={draft.modelBProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
        />
      </label>
      <div class="model-tools">
        <button class="ghost" on:click={() => onSyncModels(draft.modelBProvider)} disabled={isLoadingModels(draft.modelBProvider)}>
          <span>{isLoadingModels(draft.modelBProvider) ? 'Loading...' : `Refresh ${draft.modelBProvider}`}</span>
        </button>
        <p class="muted">{modelStatus(draft.modelBProvider)}</p>
      </div>
      <label>
        Reasoning level
        <select value={draft.modelBReasoningEffort} on:change={(event) => onSetField('modelBReasoningEffort', event.currentTarget.value)}>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
    </section>
  </div>

  <datalist id="openai-model-options">
    {#each openaiModels as model}
      <option value={model.id}>{model.label ?? model.id}</option>
    {/each}
  </datalist>

  <datalist id="anthropic-model-options">
    {#each anthropicModels as model}
      <option value={model.id}>{model.label ?? model.id}</option>
    {/each}
  </datalist>
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

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  label {
    display: grid;
    gap: 0.45rem;
    font-size: 0.9rem;
    min-width: 0;
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

  button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
    max-width: 100%;
    white-space: normal;
    line-height: 1.25;
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--ghost-border);
    color: var(--ghost-color);
  }

  .model-tools {
    display: grid;
    gap: 0.45rem;
  }

  .model-tools button {
    justify-self: start;
  }

  .muted {
    color: var(--muted-text);
    font-size: 0.85rem;
  }

  .model-sections {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .model-section {
    display: grid;
    gap: 1rem;
    border: 1px solid var(--surface-border);
    border-radius: 14px;
    padding: 1rem;
    background: var(--surface-soft);
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

  .feature-lanes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem 1rem;
  }

  .feature-lane {
    display: grid;
    gap: 0.4rem;
  }

  .feature-name {
    font-size: 0.88rem;
    color: var(--muted-text);
    font-weight: 600;
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

    .model-sections {
      grid-template-columns: 1fr;
    }

    .feature-lanes {
      grid-template-columns: 1fr;
    }
  }
</style>
