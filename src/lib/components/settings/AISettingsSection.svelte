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
        <label class:active={draft.laneSummaries === 'pipeline'}>
          <input type="radio" name="laneSummaries" value="pipeline" checked={draft.laneSummaries === 'pipeline'} on:change={() => onSetField('laneSummaries', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneSummaries === 'chat'}>
          <input type="radio" name="laneSummaries" value="chat" checked={draft.laneSummaries === 'chat'} on:change={() => onSetField('laneSummaries', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Key Points</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Key points model lane">
        <label class:active={draft.laneKeyPoints === 'pipeline'}>
          <input type="radio" name="laneKeyPoints" value="pipeline" checked={draft.laneKeyPoints === 'pipeline'} on:change={() => onSetField('laneKeyPoints', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneKeyPoints === 'chat'}>
          <input type="radio" name="laneKeyPoints" value="chat" checked={draft.laneKeyPoints === 'chat'} on:change={() => onSetField('laneKeyPoints', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Auto Tagging</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Auto tagging model lane">
        <label class:active={draft.laneAutoTagging === 'pipeline'}>
          <input type="radio" name="laneAutoTagging" value="pipeline" checked={draft.laneAutoTagging === 'pipeline'} on:change={() => onSetField('laneAutoTagging', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneAutoTagging === 'chat'}>
          <input type="radio" name="laneAutoTagging" value="chat" checked={draft.laneAutoTagging === 'chat'} on:change={() => onSetField('laneAutoTagging', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Scoring</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Scoring model lane">
        <label class:active={draft.laneScoring === 'pipeline'}>
          <input type="radio" name="laneScoring" value="pipeline" checked={draft.laneScoring === 'pipeline'} on:change={() => onSetField('laneScoring', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneScoring === 'chat'}>
          <input type="radio" name="laneScoring" value="chat" checked={draft.laneScoring === 'chat'} on:change={() => onSetField('laneScoring', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Profile Refresh</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Profile refresh model lane">
        <label class:active={draft.laneProfileRefresh === 'pipeline'}>
          <input type="radio" name="laneProfileRefresh" value="pipeline" checked={draft.laneProfileRefresh === 'pipeline'} on:change={() => onSetField('laneProfileRefresh', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneProfileRefresh === 'chat'}>
          <input type="radio" name="laneProfileRefresh" value="chat" checked={draft.laneProfileRefresh === 'chat'} on:change={() => onSetField('laneProfileRefresh', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Article Chat</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Article chat model lane">
        <label class:active={draft.laneArticleChat === 'pipeline'}>
          <input type="radio" name="laneArticleChat" value="pipeline" checked={draft.laneArticleChat === 'pipeline'} on:change={() => onSetField('laneArticleChat', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneArticleChat === 'chat'}>
          <input type="radio" name="laneArticleChat" value="chat" checked={draft.laneArticleChat === 'chat'} on:change={() => onSetField('laneArticleChat', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>

    <div class="feature-lane">
      <div class="feature-name">Global Chat</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Global chat model lane">
        <label class:active={draft.laneGlobalChat === 'pipeline'}>
          <input type="radio" name="laneGlobalChat" value="pipeline" checked={draft.laneGlobalChat === 'pipeline'} on:change={() => onSetField('laneGlobalChat', 'pipeline')} />
          <span>Pipeline</span>
        </label>
        <label class:active={draft.laneGlobalChat === 'chat'}>
          <input type="radio" name="laneGlobalChat" value="chat" checked={draft.laneGlobalChat === 'chat'} on:change={() => onSetField('laneGlobalChat', 'chat')} />
          <span>Chat</span>
        </label>
      </div>
    </div>
  </div>

  <div class="model-sections">
    <section class="model-section" aria-label="Pipeline lane settings">
      <h3>Pipeline lane (cheaper)</h3>
      <label>
        Provider
        <select value={draft.ingestProvider} on:change={(event) => onSetField('ingestProvider', event.currentTarget.value)}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <label>
        Model
        <input
          value={draft.ingestModel}
          on:input={(event) => onSetField('ingestModel', event.currentTarget.value)}
          placeholder="gpt-5-mini"
          list={draft.ingestProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
        />
      </label>
      <div class="model-tools">
        <button class="ghost" on:click={() => onSyncModels(draft.ingestProvider)} disabled={isLoadingModels(draft.ingestProvider)}>
          <span>{isLoadingModels(draft.ingestProvider) ? 'Loading...' : `Refresh ${draft.ingestProvider}`}</span>
        </button>
        <p class="muted">{modelStatus(draft.ingestProvider)}</p>
      </div>
      <label>
        Reasoning level
        <select value={draft.ingestReasoningEffort} on:change={(event) => onSetField('ingestReasoningEffort', event.currentTarget.value)}>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
    </section>

    <section class="model-section" aria-label="Chat lane settings">
      <h3>Chat lane (more capable)</h3>
      <label>
        Provider
        <select value={draft.chatProvider} on:change={(event) => onSetField('chatProvider', event.currentTarget.value)}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <label>
        Model
        <input
          value={draft.chatModel}
          on:input={(event) => onSetField('chatModel', event.currentTarget.value)}
          placeholder="gpt-5.2"
          list={draft.chatProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
        />
      </label>
      <div class="model-tools">
        <button class="ghost" on:click={() => onSyncModels(draft.chatProvider)} disabled={isLoadingModels(draft.chatProvider)}>
          <span>{isLoadingModels(draft.chatProvider) ? 'Loading...' : `Refresh ${draft.chatProvider}`}</span>
        </button>
        <p class="muted">{modelStatus(draft.chatProvider)}</p>
      </div>
      <label>
        Reasoning level
        <select value={draft.chatReasoningEffort} on:change={(event) => onSetField('chatReasoningEffort', event.currentTarget.value)}>
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
