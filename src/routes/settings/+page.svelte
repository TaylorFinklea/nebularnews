<script>
  import { invalidate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { IconDeviceFloppy, IconRefresh, IconRestore, IconTrash } from '$lib/icons';
  export let data;

  let laneSummaries = data.settings.featureLanes?.summaries ?? 'pipeline';
  let laneScoring = data.settings.featureLanes?.scoring ?? 'pipeline';
  let laneProfileRefresh = data.settings.featureLanes?.profileRefresh ?? 'pipeline';
  let laneKeyPoints = data.settings.featureLanes?.keyPoints ?? 'pipeline';
  let laneAutoTagging = data.settings.featureLanes?.autoTagging ?? 'pipeline';
  let laneArticleChat = data.settings.featureLanes?.articleChat ?? 'chat';
  let laneGlobalChat = data.settings.featureLanes?.globalChat ?? 'chat';
  let ingestProvider = data.settings.ingestProvider;
  let ingestModel = data.settings.ingestModel;
  let ingestReasoningEffort = data.settings.ingestReasoningEffort;
  let chatProvider = data.settings.chatProvider;
  let chatModel = data.settings.chatModel;
  let chatReasoningEffort = data.settings.chatReasoningEffort;
  let scoreSystemPrompt = data.settings.scoreSystemPrompt;
  let scoreUserPromptTemplate = data.settings.scoreUserPromptTemplate;
  let summaryStyle = data.settings.summaryStyle;
  let summaryLength = data.settings.summaryLength;
  let autoReadDelayMs = Number(data.settings.autoReadDelayMs ?? 4000);
  let dashboardTopRatedCutoff = Number(data.settings.dashboardTopRatedCutoff ?? 3);
  let dashboardTopRatedLimit = Number(data.settings.dashboardTopRatedLimit ?? 5);
  $: autoReadDelaySeconds = (Number(autoReadDelayMs) / 1000).toFixed(2);

  let openaiKey = '';
  let anthropicKey = '';
  let profileText = data.profile.profile_text;
  let openaiModels = [];
  let anthropicModels = [];
  let openaiModelsLoading = false;
  let anthropicModelsLoading = false;
  let openaiModelsError = '';
  let anthropicModelsError = '';
  let openaiModelsFetchedAt = null;
  let anthropicModelsFetchedAt = null;

  const getProviderModels = (provider) => (provider === 'anthropic' ? anthropicModels : openaiModels);
  const isLoadingModels = (provider) => (provider === 'anthropic' ? anthropicModelsLoading : openaiModelsLoading);

  const setProviderModelState = (provider, patch) => {
    if (provider === 'anthropic') {
      if ('models' in patch) anthropicModels = patch.models;
      if ('loading' in patch) anthropicModelsLoading = patch.loading;
      if ('error' in patch) anthropicModelsError = patch.error;
      if ('fetchedAt' in patch) anthropicModelsFetchedAt = patch.fetchedAt;
      return;
    }
    if ('models' in patch) openaiModels = patch.models;
    if ('loading' in patch) openaiModelsLoading = patch.loading;
    if ('error' in patch) openaiModelsError = patch.error;
    if ('fetchedAt' in patch) openaiModelsFetchedAt = patch.fetchedAt;
  };

  const modelStatus = (provider) => {
    const error = provider === 'anthropic' ? anthropicModelsError : openaiModelsError;
    const loading = provider === 'anthropic' ? anthropicModelsLoading : openaiModelsLoading;
    const fetchedAt = provider === 'anthropic' ? anthropicModelsFetchedAt : openaiModelsFetchedAt;
    const count = getProviderModels(provider).length;

    if (error) return error;
    if (loading) return 'Loading models...';
    if (!count) return 'No models cached yet.';
    if (!fetchedAt) return `${count} models loaded`;
    return `${count} models loaded · ${new Date(fetchedAt).toLocaleTimeString()}`;
  };

  const syncModels = async (provider, { silent = false } = {}) => {
    setProviderModelState(provider, { loading: true, error: '' });
    try {
      const res = await fetch(`/api/models?provider=${provider}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent) setProviderModelState(provider, { error: payload?.error ?? 'Model sync failed' });
        return;
      }
      setProviderModelState(provider, {
        models: Array.isArray(payload?.models) ? payload.models : [],
        fetchedAt: payload?.fetchedAt ?? Date.now(),
        error: ''
      });
    } catch {
      if (!silent) setProviderModelState(provider, { error: 'Model sync failed' });
    } finally {
      setProviderModelState(provider, { loading: false });
    }
  };

  onMount(() => {
    if (data.keyMap.openai) void syncModels('openai', { silent: true });
    if (data.keyMap.anthropic) void syncModels('anthropic', { silent: true });
  });

  const saveSettings = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        featureLanes: {
          summaries: laneSummaries,
          scoring: laneScoring,
          profileRefresh: laneProfileRefresh,
          keyPoints: laneKeyPoints,
          autoTagging: laneAutoTagging,
          articleChat: laneArticleChat,
          globalChat: laneGlobalChat
        },
        ingestProvider,
        ingestModel,
        ingestReasoningEffort,
        chatProvider,
        chatModel,
        chatReasoningEffort,
        summaryStyle,
        summaryLength,
        autoReadDelayMs,
        dashboardTopRatedCutoff,
        dashboardTopRatedLimit
      })
    });
    await invalidate();
  };

  const saveScorePrompt = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scoreSystemPrompt,
        scoreUserPromptTemplate
      })
    });
    await invalidate();
  };

  const resetScorePromptDefaults = () => {
    scoreSystemPrompt = data.scorePromptDefaults.scoreSystemPrompt;
    scoreUserPromptTemplate = data.scorePromptDefaults.scoreUserPromptTemplate;
  };

  const saveKey = async (provider) => {
    const key = provider === 'openai' ? openaiKey : anthropicKey;
    if (!key) return;
    await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: key })
    });
    openaiKey = '';
    anthropicKey = '';
    await invalidate();
    await syncModels(provider);
  };

  const removeKey = async (provider) => {
    await fetch(`/api/keys/${provider}`, { method: 'DELETE' });
    setProviderModelState(provider, { models: [], error: '', fetchedAt: null });
    await invalidate();
  };

  const saveProfile = async () => {
    if (!profileText) return;
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileText })
    });
    await invalidate();
  };
</script>

<section class="page-header">
  <div>
    <h1>Settings</h1>
    <p>Configure model routing, provider keys, and summarization defaults.</p>
  </div>
</section>

<div class="grid">
  <div class="card span-two">
    <h2>AI Feature Routing</h2>
    <p class="muted">
      Set the model lane per AI feature.
    </p>
    <div class="feature-lanes">
      <div class="feature-lane">
        <div class="feature-name">Summaries</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Summaries model lane">
          <label class:active={laneSummaries === 'pipeline'}>
            <input type="radio" name="laneSummaries" value="pipeline" bind:group={laneSummaries} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneSummaries === 'chat'}>
            <input type="radio" name="laneSummaries" value="chat" bind:group={laneSummaries} />
            <span>Chat</span>
          </label>
        </div>
      </div>

      <div class="feature-lane">
        <div class="feature-name">Key Points</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Key points model lane">
          <label class:active={laneKeyPoints === 'pipeline'}>
            <input type="radio" name="laneKeyPoints" value="pipeline" bind:group={laneKeyPoints} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneKeyPoints === 'chat'}>
            <input type="radio" name="laneKeyPoints" value="chat" bind:group={laneKeyPoints} />
            <span>Chat</span>
          </label>
        </div>
      </div>

      <div class="feature-lane">
        <div class="feature-name">Auto Tagging</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Auto tagging model lane">
          <label class:active={laneAutoTagging === 'pipeline'}>
            <input type="radio" name="laneAutoTagging" value="pipeline" bind:group={laneAutoTagging} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneAutoTagging === 'chat'}>
            <input type="radio" name="laneAutoTagging" value="chat" bind:group={laneAutoTagging} />
            <span>Chat</span>
          </label>
        </div>
      </div>

      <div class="feature-lane">
        <div class="feature-name">Scoring</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Scoring model lane">
          <label class:active={laneScoring === 'pipeline'}>
            <input type="radio" name="laneScoring" value="pipeline" bind:group={laneScoring} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneScoring === 'chat'}>
            <input type="radio" name="laneScoring" value="chat" bind:group={laneScoring} />
            <span>Chat</span>
          </label>
        </div>
      </div>

      <div class="feature-lane">
        <div class="feature-name">Profile Refresh</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Profile refresh model lane">
          <label class:active={laneProfileRefresh === 'pipeline'}>
            <input type="radio" name="laneProfileRefresh" value="pipeline" bind:group={laneProfileRefresh} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneProfileRefresh === 'chat'}>
            <input type="radio" name="laneProfileRefresh" value="chat" bind:group={laneProfileRefresh} />
            <span>Chat</span>
          </label>
        </div>
      </div>

      <div class="feature-lane">
        <div class="feature-name">Article Chat</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Article chat model lane">
          <label class:active={laneArticleChat === 'pipeline'}>
            <input type="radio" name="laneArticleChat" value="pipeline" bind:group={laneArticleChat} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneArticleChat === 'chat'}>
            <input type="radio" name="laneArticleChat" value="chat" bind:group={laneArticleChat} />
            <span>Chat</span>
          </label>
        </div>
      </div>

      <div class="feature-lane">
        <div class="feature-name">Global Chat</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Global chat model lane">
          <label class:active={laneGlobalChat === 'pipeline'}>
            <input type="radio" name="laneGlobalChat" value="pipeline" bind:group={laneGlobalChat} />
            <span>Pipeline</span>
          </label>
          <label class:active={laneGlobalChat === 'chat'}>
            <input type="radio" name="laneGlobalChat" value="chat" bind:group={laneGlobalChat} />
            <span>Chat</span>
          </label>
        </div>
      </div>
    </div>
    <button on:click={saveSettings} class="inline-button">
      <IconDeviceFloppy size={16} stroke={1.9} />
      <span>Save</span>
    </button>
  </div>

  <div class="card">
    <h2>Pipeline model (cheaper)</h2>
    <label>
      Provider
      <select bind:value={ingestProvider}>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
    </label>
    <label>
      Model
      <input
        bind:value={ingestModel}
        placeholder="gpt-5-mini"
        list={ingestProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
      />
    </label>
    <div class="model-tools">
      <button class="ghost" on:click={() => syncModels(ingestProvider)} disabled={isLoadingModels(ingestProvider)}>
        <IconRefresh size={16} stroke={1.9} />
        <span>{isLoadingModels(ingestProvider) ? 'Loading...' : `Refresh ${ingestProvider}`}</span>
      </button>
      <p class="muted">{modelStatus(ingestProvider)}</p>
    </div>
    <label>
      Reasoning level
      <select bind:value={ingestReasoningEffort}>
        <option value="minimal">Minimal</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
    <p class="muted">This defines the Pipeline model lane configuration.</p>
  </div>

  <div class="card">
    <h2>Chat model (more capable)</h2>
    <label>
      Provider
      <select bind:value={chatProvider}>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
    </label>
    <label>
      Model
      <input
        bind:value={chatModel}
        placeholder="gpt-5.2"
        list={chatProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
      />
    </label>
    <div class="model-tools">
      <button class="ghost" on:click={() => syncModels(chatProvider)} disabled={isLoadingModels(chatProvider)}>
        <IconRefresh size={16} stroke={1.9} />
        <span>{isLoadingModels(chatProvider) ? 'Loading...' : `Refresh ${chatProvider}`}</span>
      </button>
      <p class="muted">{modelStatus(chatProvider)}</p>
    </div>
    <label>
      Reasoning level
      <select bind:value={chatReasoningEffort}>
        <option value="minimal">Minimal</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
    <p class="muted">This defines the Chat model lane configuration.</p>
  </div>

  <div class="card">
    <h2>Behavior defaults</h2>
    <label>
      Summary style
      <select bind:value={summaryStyle}>
        <option value="concise">Concise</option>
        <option value="detailed">Detailed</option>
        <option value="bullet">Bullet-heavy</option>
      </select>
    </label>
    <label>
      Summary length
      <select bind:value={summaryLength}>
        <option value="short">Short</option>
        <option value="medium">Medium</option>
        <option value="long">Long</option>
      </select>
    </label>
    <label>
      Mark article as read after (ms)
      <input
        type="number"
        min={data.autoReadDelayRange.min}
        max={data.autoReadDelayRange.max}
        step="250"
        bind:value={autoReadDelayMs}
      />
    </label>
    <p class="muted">
      Applies on article detail pages. Current delay: {autoReadDelaySeconds}s. 0 means immediate. Range {data.autoReadDelayRange.min}-{data.autoReadDelayRange.max} ms.
    </p>
    <label>
      Dashboard top-rated cutoff (1-5)
      <input
        type="number"
        min={data.dashboardTopRatedRange.cutoff.min}
        max={data.dashboardTopRatedRange.cutoff.max}
        step="1"
        bind:value={dashboardTopRatedCutoff}
      />
    </label>
    <label>
      Dashboard top-rated count
      <input
        type="number"
        min={data.dashboardTopRatedRange.limit.min}
        max={data.dashboardTopRatedRange.limit.max}
        step="1"
        bind:value={dashboardTopRatedLimit}
      />
    </label>
    <p class="muted">
      Controls the dashboard's Top Rated section. Cutoff range {data.dashboardTopRatedRange.cutoff.min}-{data.dashboardTopRatedRange.cutoff.max}; count range {data.dashboardTopRatedRange.limit.min}-{data.dashboardTopRatedRange.limit.max}.
    </p>
    <button on:click={saveSettings} class="inline-button">
      <IconDeviceFloppy size={16} stroke={1.9} />
      <span>Save</span>
    </button>
  </div>

  <div class="card span-two">
    <h2>AI Fit Score Algorithm</h2>
    <p class="muted">
      This global prompt controls how relevance is scored for all articles. Variables:
      <code>{'{{profile}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{url}}'}</code>, <code>{'{{content}}'}</code>.
    </p>
    <label>
      System prompt
      <textarea rows="4" bind:value={scoreSystemPrompt}></textarea>
    </label>
    <label>
      User prompt template
      <textarea rows="12" bind:value={scoreUserPromptTemplate}></textarea>
    </label>
    <div class="row-actions">
      <button on:click={saveScorePrompt} class="inline-button">
        <IconDeviceFloppy size={16} stroke={1.9} />
        <span>Save prompt</span>
      </button>
      <button class="ghost inline-button" on:click={resetScorePromptDefaults}>
        <IconRestore size={16} stroke={1.9} />
        <span>Reset</span>
      </button>
    </div>
  </div>

  <div class="card">
    <h2>API Keys</h2>
    <div class="key-row">
      <div>
        <strong>OpenAI</strong>
        <p class="muted">{data.keyMap.openai ? 'Key stored' : 'No key yet'}</p>
      </div>
      <button class="ghost icon-button" on:click={() => removeKey('openai')} title="Remove OpenAI key" aria-label="Remove OpenAI key">
        <IconTrash size={16} stroke={1.9} />
        <span class="sr-only">Remove OpenAI key</span>
      </button>
    </div>
    <input type="password" placeholder="Paste OpenAI key" bind:value={openaiKey} />
    <button on:click={() => saveKey('openai')} class="inline-button">
      <IconDeviceFloppy size={16} stroke={1.9} />
      <span>Save OpenAI key</span>
    </button>

    <div class="divider"></div>

    <div class="key-row">
      <div>
        <strong>Anthropic</strong>
        <p class="muted">{data.keyMap.anthropic ? 'Key stored' : 'No key yet'}</p>
      </div>
      <button class="ghost icon-button" on:click={() => removeKey('anthropic')} title="Remove Anthropic key" aria-label="Remove Anthropic key">
        <IconTrash size={16} stroke={1.9} />
        <span class="sr-only">Remove Anthropic key</span>
      </button>
    </div>
    <input type="password" placeholder="Paste Anthropic key" bind:value={anthropicKey} />
    <button on:click={() => saveKey('anthropic')} class="inline-button">
      <IconDeviceFloppy size={16} stroke={1.9} />
      <span>Save Anthropic key</span>
    </button>
  </div>

  <div class="card">
    <h2>AI Preference Profile</h2>
    <p class="muted">Version {data.profile.version} · Updated {new Date(data.profile.updated_at).toLocaleString()}</p>
    <textarea rows="8" bind:value={profileText}></textarea>
    <button on:click={saveProfile} class="inline-button">
      <IconDeviceFloppy size={16} stroke={1.9} />
      <span>Save profile</span>
    </button>
  </div>
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

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 1.75rem;
  }

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

  input,
  select,
  textarea {
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

  .key-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .divider {
    height: 1px;
    background: var(--surface-border);
    margin: 0.8rem 0;
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

  .span-two {
    grid-column: 1 / -1;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .inline-button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .icon-button {
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
    gap: 0.75rem;
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
    .grid {
      grid-template-columns: 1fr;
      gap: 1.25rem;
    }

    .card {
      padding: 1.25rem;
    }

    .span-two {
      grid-column: span 1;
    }
  }
</style>
