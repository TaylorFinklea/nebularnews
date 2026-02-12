<script>
  import { invalidate } from '$app/navigation';
  export let data;

  let defaultProvider = data.settings.defaultProvider;
  let defaultModel = data.settings.defaultModel;
  let reasoningEffort = data.settings.reasoningEffort;
  let summaryStyle = data.settings.summaryStyle;
  let summaryLength = data.settings.summaryLength;

  let openaiKey = '';
  let anthropicKey = '';
  let profileText = data.profile.profile_text;

  const saveSettings = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultProvider, defaultModel, reasoningEffort, summaryStyle, summaryLength })
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
  };

  const removeKey = async (provider) => {
    await fetch(`/api/keys/${provider}`, { method: 'DELETE' });
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
    <p>Configure your LLM provider keys and summarization defaults.</p>
  </div>
</section>

<div class="grid">
  <div class="card">
    <h2>Default model</h2>
    <label>
      Provider
      <select bind:value={defaultProvider}>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
    </label>
    <label>
      Model
      <input bind:value={defaultModel} placeholder="gpt-4o-mini" />
    </label>
    <label>
      Reasoning level
      <select bind:value={reasoningEffort}>
        <option value="minimal">Minimal</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
    <p class="muted">Applied to OpenAI requests (for example `gpt-5.2`).</p>
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
    <button on:click={saveSettings}>Save defaults</button>
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

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .card {
    background: rgba(255, 255, 255, 0.94);
    padding: 1.5rem;
    border-radius: 20px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
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
    border: 1px solid rgba(0, 0, 0, 0.15);
  }

  button {
    background: #1f1f1f;
    color: white;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    cursor: pointer;
  }

  .ghost {
    background: transparent;
    border: 1px solid rgba(197, 91, 42, 0.4);
    color: #c55b2a;
  }

  .key-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .divider {
    height: 1px;
    background: rgba(0, 0, 0, 0.08);
    margin: 0.8rem 0;
  }

  .muted {
    color: rgba(0, 0, 0, 0.6);
    font-size: 0.85rem;
  }
</style>
