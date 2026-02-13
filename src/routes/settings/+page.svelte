<script>
  import { invalidate } from '$app/navigation';
  import { onMount } from 'svelte';
  export let data;

  let ingestProvider = data.settings.ingestProvider;
  let ingestModel = data.settings.ingestModel;
  let ingestReasoningEffort = data.settings.ingestReasoningEffort;
  let chatProvider = data.settings.chatProvider;
  let chatModel = data.settings.chatModel;
  let chatReasoningEffort = data.settings.chatReasoningEffort;
  let summaryStyle = data.settings.summaryStyle;
  let summaryLength = data.settings.summaryLength;

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
        ingestProvider,
        ingestModel,
        ingestReasoningEffort,
        chatProvider,
        chatModel,
        chatReasoningEffort,
        summaryStyle,
        summaryLength
      })
    });
    await invalidate();
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
        {isLoadingModels(ingestProvider) ? 'Loading models...' : `Refresh ${ingestProvider} models`}
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
    <p class="muted">Used for summarize, score, and profile-refresh jobs.</p>
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
        {isLoadingModels(chatProvider) ? 'Loading models...' : `Refresh ${chatProvider} models`}
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
    <p class="muted">Used for global chat and article chat responses.</p>
  </div>

  <div class="card">
    <h2>Summary defaults</h2>
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
    <button on:click={saveSettings}>Save model settings</button>
  </div>

  <div class="card">
    <h2>API Keys</h2>
    <div class="key-row">
      <div>
        <strong>OpenAI</strong>
        <p class="muted">{data.keyMap.openai ? 'Key stored' : 'No key yet'}</p>
      </div>
      <button class="ghost" on:click={() => removeKey('openai')}>Remove</button>
    </div>
    <input type="password" placeholder="Paste OpenAI key" bind:value={openaiKey} />
    <button on:click={() => saveKey('openai')}>Save OpenAI key</button>

    <div class="divider"></div>

    <div class="key-row">
      <div>
        <strong>Anthropic</strong>
        <p class="muted">{data.keyMap.anthropic ? 'Key stored' : 'No key yet'}</p>
      </div>
      <button class="ghost" on:click={() => removeKey('anthropic')}>Remove</button>
    </div>
    <input type="password" placeholder="Paste Anthropic key" bind:value={anthropicKey} />
    <button on:click={() => saveKey('anthropic')}>Save Anthropic key</button>
  </div>

  <div class="card">
    <h2>AI Preference Profile</h2>
    <p class="muted">Version {data.profile.version} · Updated {new Date(data.profile.updated_at).toLocaleString()}</p>
    <textarea rows="8" bind:value={profileText}></textarea>
    <button on:click={saveProfile}>Save profile</button>
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
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .card {
    background: var(--surface-strong);
    padding: 1.5rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px var(--shadow-color);
    border: 1px solid var(--surface-border);
    display: grid;
    gap: 0.8rem;
  }

  label {
    display: grid;
    gap: 0.4rem;
    font-size: 0.9rem;
  }

  input,
  select {
    width: 100%;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid var(--input-border);
  }

  button {
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--ghost-border);
    color: var(--ghost-color);
  }

  .key-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
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
</style>
