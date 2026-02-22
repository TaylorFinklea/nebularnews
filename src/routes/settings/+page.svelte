<script>
  import { invalidate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { IconDeviceFloppy, IconRefresh, IconRestore, IconTrash } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import { showToast } from '$lib/client/toast';
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
  let initialFeedLookbackDays = Number(data.settings.initialFeedLookbackDays ?? data.initialFeedLookbackRange?.default ?? 45);
  let retentionDays = Number(data.settings.retentionDays ?? data.retentionRange?.default ?? 0);
  let retentionMode = data.settings.retentionMode ?? 'archive';
  let autoReadDelayMs = Number(data.settings.autoReadDelayMs ?? 4000);
  let articleCardLayout = data.settings.articleCardLayout ?? 'split';
  let dashboardTopRatedLayout = data.settings.dashboardTopRatedLayout ?? 'stacked';
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
  let isSaving = false;
  let hasUnsavedChanges = false;

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
    return `${count} models · ${new Date(fetchedAt).toLocaleTimeString()}`;
  };

  const syncModels = async (provider, { silent = false } = {}) => {
    setProviderModelState(provider, { loading: true, error: '' });
    try {
      const res = await apiFetch(`/api/models?provider=${provider}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent) setProviderModelState(provider, { error: payload?.error ?? 'Model sync failed' });
        return;
      }
      setProviderModelState(provider, { models: Array.isArray(payload?.models) ? payload.models : [], fetchedAt: payload?.fetchedAt ?? Date.now(), error: '' });
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

  const snapshotObject = () => ({
    laneSummaries, laneScoring, laneProfileRefresh, laneKeyPoints, laneAutoTagging, laneArticleChat, laneGlobalChat,
    ingestProvider, ingestModel, ingestReasoningEffort, chatProvider, chatModel, chatReasoningEffort,
    summaryStyle, summaryLength,
    initialFeedLookbackDays: Number(initialFeedLookbackDays ?? 0),
    retentionDays: Number(retentionDays ?? 0), retentionMode,
    autoReadDelayMs: Number(autoReadDelayMs ?? 0), articleCardLayout,
    dashboardTopRatedLayout, dashboardTopRatedCutoff: Number(dashboardTopRatedCutoff ?? 0),
    dashboardTopRatedLimit: Number(dashboardTopRatedLimit ?? 0),
    scoreSystemPrompt, scoreUserPromptTemplate, profileText
  });

  let savedSnapshot = snapshotObject();
  let currentSnapshot = snapshotObject();
  $: currentSnapshot = snapshotObject();
  $: hasUnsavedChanges = JSON.stringify(currentSnapshot) !== JSON.stringify(savedSnapshot);

  const applySnapshot = (snapshot) => {
    laneSummaries = snapshot.laneSummaries; laneScoring = snapshot.laneScoring;
    laneProfileRefresh = snapshot.laneProfileRefresh; laneKeyPoints = snapshot.laneKeyPoints;
    laneAutoTagging = snapshot.laneAutoTagging; laneArticleChat = snapshot.laneArticleChat;
    laneGlobalChat = snapshot.laneGlobalChat; ingestProvider = snapshot.ingestProvider;
    ingestModel = snapshot.ingestModel; ingestReasoningEffort = snapshot.ingestReasoningEffort;
    chatProvider = snapshot.chatProvider; chatModel = snapshot.chatModel;
    chatReasoningEffort = snapshot.chatReasoningEffort; summaryStyle = snapshot.summaryStyle;
    summaryLength = snapshot.summaryLength; initialFeedLookbackDays = Number(snapshot.initialFeedLookbackDays ?? 0);
    retentionDays = Number(snapshot.retentionDays ?? 0); retentionMode = snapshot.retentionMode;
    autoReadDelayMs = Number(snapshot.autoReadDelayMs ?? 0); articleCardLayout = snapshot.articleCardLayout;
    dashboardTopRatedLayout = snapshot.dashboardTopRatedLayout;
    dashboardTopRatedCutoff = Number(snapshot.dashboardTopRatedCutoff ?? 0);
    dashboardTopRatedLimit = Number(snapshot.dashboardTopRatedLimit ?? 0);
    scoreSystemPrompt = snapshot.scoreSystemPrompt; scoreUserPromptTemplate = snapshot.scoreUserPromptTemplate;
    profileText = snapshot.profileText;
  };

  const readApiError = async (res, fallback) => {
    const payload = await res.json().catch(() => ({}));
    return payload?.error ?? fallback;
  };

  const saveAllChanges = async () => {
    if (isSaving || !hasUnsavedChanges) return;
    isSaving = true;
    try {
      const settingsRes = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          featureLanes: { summaries: laneSummaries, scoring: laneScoring, profileRefresh: laneProfileRefresh, keyPoints: laneKeyPoints, autoTagging: laneAutoTagging, articleChat: laneArticleChat, globalChat: laneGlobalChat },
          ingestProvider, ingestModel, ingestReasoningEffort, chatProvider, chatModel, chatReasoningEffort,
          summaryStyle, summaryLength, initialFeedLookbackDays, retentionDays, retentionMode,
          autoReadDelayMs, articleCardLayout, dashboardTopRatedLayout, dashboardTopRatedCutoff, dashboardTopRatedLimit,
          scoreSystemPrompt, scoreUserPromptTemplate
        })
      });
      if (!settingsRes.ok) { showToast(await readApiError(settingsRes, 'Failed to save settings'), 'error'); return; }

      const nextProfile = profileText.trim();
      if (nextProfile) {
        const profileRes = await apiFetch('/api/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profileText: nextProfile })
        });
        if (!profileRes.ok) { showToast(await readApiError(profileRes, 'Failed to save profile'), 'error'); return; }
      }

      savedSnapshot = { ...currentSnapshot };
      showToast('Settings saved.', 'success');
      await invalidate();
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      isSaving = false;
    }
  };

  const resetScorePromptDefaults = () => {
    scoreSystemPrompt = data.scorePromptDefaults.scoreSystemPrompt;
    scoreUserPromptTemplate = data.scorePromptDefaults.scoreUserPromptTemplate;
  };

  const discardChanges = () => { applySnapshot(savedSnapshot); };

  const saveKey = async (provider) => {
    const key = provider === 'openai' ? openaiKey : anthropicKey;
    if (!key) return;
    await apiFetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: key })
    });
    if (provider === 'openai') openaiKey = ''; else anthropicKey = '';
    showToast(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key saved.`, 'success');
    await invalidate();
    await syncModels(provider);
  };

  const removeKey = async (provider) => {
    await apiFetch(`/api/keys/${provider}`, { method: 'DELETE' });
    setProviderModelState(provider, { models: [], error: '', fetchedAt: null });
    showToast(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key removed.`, 'success');
    await invalidate();
  };

  const rotateKeys = async (provider = null) => {
    await apiFetch('/api/keys/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    showToast('Keys rotated.', 'success');
    await invalidate();
  };
</script>

<PageHeader title="Settings" description="Configure AI behavior, prompts, keys, and display defaults.">
  <svelte:fragment slot="subnav">
    <nav class="settings-subnav" aria-label="Settings sections">
      <a href="#models">AI settings</a>
      <a href="#behavior">Behavior</a>
      <a href="#prompts">Prompts</a>
      <a href="#keys">Keys</a>
      <a href="#profile">Profile</a>
    </nav>
  </svelte:fragment>
  <svelte:fragment slot="actions">
    <div class="save-actions">
      {#if hasUnsavedChanges}
        <span class="unsaved-badge">Unsaved changes</span>
      {/if}
      <Button variant="ghost" size="inline" on:click={discardChanges} disabled={!hasUnsavedChanges || isSaving}>
        <IconRestore size={15} stroke={1.9} />
        <span>Discard</span>
      </Button>
      <Button variant="primary" size="inline" on:click={saveAllChanges} disabled={!hasUnsavedChanges || isSaving}>
        <IconDeviceFloppy size={15} stroke={1.9} />
        <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
      </Button>
    </div>
  </svelte:fragment>
</PageHeader>

<div class="settings-stack">
  <!-- AI Settings -->
  <Card id="models">
    <h2>AI Settings</h2>

    <div class="section-block">
      <h3>Feature routing</h3>
      <p class="muted">Assign each AI feature to a model lane.</p>
      <div class="feature-lanes">
        {#each [
          ['Summaries', 'laneSummaries', 'laneSum'],
          ['Key Points', 'laneKeyPoints', 'laneKP'],
          ['Auto Tagging', 'laneAutoTagging', 'laneAT'],
          ['Scoring', 'laneScoring', 'laneSc'],
          ['Profile Refresh', 'laneProfileRefresh', 'lanePR'],
          ['Article Chat', 'laneArticleChat', 'laneAC'],
          ['Global Chat', 'laneGlobalChat', 'laneGC']
        ] as [label]}
          <div class="feature-lane">
            <div class="feature-name">{label}</div>
            <div class="lane-toggle" role="radiogroup" aria-label={`${label} lane`}>
              {#if label === 'Summaries'}
                <label class:active={laneSummaries === 'pipeline'}><input type="radio" name="laneSummaries" value="pipeline" bind:group={laneSummaries} /><span>Pipeline</span></label>
                <label class:active={laneSummaries === 'chat'}><input type="radio" name="laneSummaries" value="chat" bind:group={laneSummaries} /><span>Chat</span></label>
              {:else if label === 'Key Points'}
                <label class:active={laneKeyPoints === 'pipeline'}><input type="radio" name="laneKeyPoints" value="pipeline" bind:group={laneKeyPoints} /><span>Pipeline</span></label>
                <label class:active={laneKeyPoints === 'chat'}><input type="radio" name="laneKeyPoints" value="chat" bind:group={laneKeyPoints} /><span>Chat</span></label>
              {:else if label === 'Auto Tagging'}
                <label class:active={laneAutoTagging === 'pipeline'}><input type="radio" name="laneAutoTagging" value="pipeline" bind:group={laneAutoTagging} /><span>Pipeline</span></label>
                <label class:active={laneAutoTagging === 'chat'}><input type="radio" name="laneAutoTagging" value="chat" bind:group={laneAutoTagging} /><span>Chat</span></label>
              {:else if label === 'Scoring'}
                <label class:active={laneScoring === 'pipeline'}><input type="radio" name="laneScoring" value="pipeline" bind:group={laneScoring} /><span>Pipeline</span></label>
                <label class:active={laneScoring === 'chat'}><input type="radio" name="laneScoring" value="chat" bind:group={laneScoring} /><span>Chat</span></label>
              {:else if label === 'Profile Refresh'}
                <label class:active={laneProfileRefresh === 'pipeline'}><input type="radio" name="laneProfileRefresh" value="pipeline" bind:group={laneProfileRefresh} /><span>Pipeline</span></label>
                <label class:active={laneProfileRefresh === 'chat'}><input type="radio" name="laneProfileRefresh" value="chat" bind:group={laneProfileRefresh} /><span>Chat</span></label>
              {:else if label === 'Article Chat'}
                <label class:active={laneArticleChat === 'pipeline'}><input type="radio" name="laneArticleChat" value="pipeline" bind:group={laneArticleChat} /><span>Pipeline</span></label>
                <label class:active={laneArticleChat === 'chat'}><input type="radio" name="laneArticleChat" value="chat" bind:group={laneArticleChat} /><span>Chat</span></label>
              {:else if label === 'Global Chat'}
                <label class:active={laneGlobalChat === 'pipeline'}><input type="radio" name="laneGlobalChat" value="pipeline" bind:group={laneGlobalChat} /><span>Pipeline</span></label>
                <label class:active={laneGlobalChat === 'chat'}><input type="radio" name="laneGlobalChat" value="chat" bind:group={laneGlobalChat} /><span>Chat</span></label>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div class="divider"></div>

    <div class="model-sections">
      <div class="model-section">
        <h3>Pipeline lane</h3>
        <p class="muted">Cheaper, faster. Used for batch jobs.</p>
        <label>Provider <select bind:value={ingestProvider}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
        <label>Model <input bind:value={ingestModel} placeholder="gpt-4o-mini" list={ingestProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'} /></label>
        <div class="model-tools">
          <Button variant="ghost" size="inline" on:click={() => syncModels(ingestProvider)} disabled={isLoadingModels(ingestProvider)}>
            <IconRefresh size={14} stroke={1.9} />
            <span>{isLoadingModels(ingestProvider) ? 'Loading...' : `Refresh ${ingestProvider}`}</span>
          </Button>
          <p class="muted small">{modelStatus(ingestProvider)}</p>
        </div>
        <label>Reasoning level
          <select bind:value={ingestReasoningEffort}>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>

      <div class="model-section">
        <h3>Chat lane</h3>
        <p class="muted">More capable. Used for chat and complex tasks.</p>
        <label>Provider <select bind:value={chatProvider}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
        <label>Model <input bind:value={chatModel} placeholder="gpt-4o" list={chatProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'} /></label>
        <div class="model-tools">
          <Button variant="ghost" size="inline" on:click={() => syncModels(chatProvider)} disabled={isLoadingModels(chatProvider)}>
            <IconRefresh size={14} stroke={1.9} />
            <span>{isLoadingModels(chatProvider) ? 'Loading...' : `Refresh ${chatProvider}`}</span>
          </Button>
          <p class="muted small">{modelStatus(chatProvider)}</p>
        </div>
        <label>Reasoning level
          <select bind:value={chatReasoningEffort}>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
    </div>
  </Card>

  <!-- Behavior -->
  <Card id="behavior">
    <h2>Behavior defaults</h2>

    <div class="two-col">
      <label>Summary style
        <select bind:value={summaryStyle}>
          <option value="concise">Concise</option>
          <option value="detailed">Detailed</option>
          <option value="bullet">Bullet-heavy</option>
        </select>
      </label>
      <label>Summary length
        <select bind:value={summaryLength}>
          <option value="short">Short</option>
          <option value="medium">Medium</option>
          <option value="long">Long</option>
        </select>
      </label>
    </div>

    <label>
      Initial feed backfill window (days)
      <input type="number" min={data.initialFeedLookbackRange.min} max={data.initialFeedLookbackRange.max} step="1" bind:value={initialFeedLookbackDays} />
      <span class="hint">Default {data.initialFeedLookbackRange.default} days. 0 = include all history.</span>
    </label>

    <label>
      Retention window (days)
      <input type="number" min={data.retentionRange.min} max={data.retentionRange.max} step="1" bind:value={retentionDays} />
    </label>

    <div class="field">
      <div class="field-label">Retention mode</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Retention mode">
        <label class:active={retentionMode === 'archive'}><input type="radio" name="retentionMode" value="archive" bind:group={retentionMode} /><span>Archive text</span></label>
        <label class:active={retentionMode === 'delete'}><input type="radio" name="retentionMode" value="delete" bind:group={retentionMode} /><span>Delete records</span></label>
      </div>
      <span class="hint">Daily cleanup runs at 03:30 UTC. 0 days disables cleanup.</span>
    </div>

    <label>
      Mark read after (ms)
      <input type="number" min={data.autoReadDelayRange.min} max={data.autoReadDelayRange.max} step="250" bind:value={autoReadDelayMs} />
      <span class="hint">Current: {autoReadDelaySeconds}s. 0 = immediate.</span>
    </label>

    <div class="two-col">
      <div class="field">
        <div class="field-label">Article card layout</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Article card layout">
          <label class:active={articleCardLayout === 'split'}><input type="radio" name="articleCardLayout" value="split" bind:group={articleCardLayout} /><span>Split</span></label>
          <label class:active={articleCardLayout === 'stacked'}><input type="radio" name="articleCardLayout" value="stacked" bind:group={articleCardLayout} /><span>Stacked</span></label>
        </div>
      </div>
      <div class="field">
        <div class="field-label">Dashboard top-rated layout</div>
        <div class="lane-toggle" role="radiogroup" aria-label="Dashboard top-rated layout">
          <label class:active={dashboardTopRatedLayout === 'split'}><input type="radio" name="dashboardTopRatedLayout" value="split" bind:group={dashboardTopRatedLayout} /><span>Split</span></label>
          <label class:active={dashboardTopRatedLayout === 'stacked'}><input type="radio" name="dashboardTopRatedLayout" value="stacked" bind:group={dashboardTopRatedLayout} /><span>Stacked</span></label>
        </div>
      </div>
    </div>

    <div class="two-col">
      <label>
        Top-rated cutoff (1–5)
        <input type="number" min={data.dashboardTopRatedRange.cutoff.min} max={data.dashboardTopRatedRange.cutoff.max} step="1" bind:value={dashboardTopRatedCutoff} />
      </label>
      <label>
        Top-rated count
        <input type="number" min={data.dashboardTopRatedRange.limit.min} max={data.dashboardTopRatedRange.limit.max} step="1" bind:value={dashboardTopRatedLimit} />
      </label>
    </div>
  </Card>

  <!-- API Keys -->
  <Card id="keys">
    <div class="card-title-row">
      <h2>API Keys</h2>
      <Button variant="ghost" size="inline" on:click={() => rotateKeys()}>
        <IconRefresh size={14} stroke={1.9} />
        <span>Rotate ciphers</span>
      </Button>
    </div>

    <div class="key-block">
      <div class="key-row">
        <div>
          <strong>OpenAI</strong>
          <p class="muted small">{data.keyMap.openai ? 'Key stored' : 'No key yet'}</p>
        </div>
        <Button variant="danger" size="icon" on:click={() => removeKey('openai')} title="Remove OpenAI key">
          <IconTrash size={15} stroke={1.9} />
        </Button>
      </div>
      <input type="password" placeholder="Paste OpenAI key" bind:value={openaiKey} />
      <Button size="inline" on:click={() => saveKey('openai')} disabled={!openaiKey}>
        <IconDeviceFloppy size={15} stroke={1.9} />
        <span>Save OpenAI key</span>
      </Button>
    </div>

    <div class="divider"></div>

    <div class="key-block">
      <div class="key-row">
        <div>
          <strong>Anthropic</strong>
          <p class="muted small">{data.keyMap.anthropic ? 'Key stored' : 'No key yet'}</p>
        </div>
        <Button variant="danger" size="icon" on:click={() => removeKey('anthropic')} title="Remove Anthropic key">
          <IconTrash size={15} stroke={1.9} />
        </Button>
      </div>
      <input type="password" placeholder="Paste Anthropic key" bind:value={anthropicKey} />
      <Button size="inline" on:click={() => saveKey('anthropic')} disabled={!anthropicKey}>
        <IconDeviceFloppy size={15} stroke={1.9} />
        <span>Save Anthropic key</span>
      </Button>
    </div>
  </Card>

  <!-- Prompts -->
  <Card id="prompts">
    <div class="card-title-row">
      <h2>AI Fit Score Prompts</h2>
      <Button variant="ghost" size="inline" on:click={resetScorePromptDefaults}>
        <IconRestore size={14} stroke={1.9} />
        <span>Reset defaults</span>
      </Button>
    </div>
    <p class="muted">Variables: <code>{'{{profile}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{url}}'}</code>, <code>{'{{content}}'}</code>.</p>
    <label>System prompt <textarea rows="4" bind:value={scoreSystemPrompt}></textarea></label>
    <label>User prompt template <textarea rows="12" bind:value={scoreUserPromptTemplate}></textarea></label>
  </Card>

  <!-- Profile -->
  <Card id="profile">
    <h2>AI Preference Profile</h2>
    <p class="muted">Version {data.profile.version} · Updated {new Date(data.profile.updated_at).toLocaleString()}</p>
    <textarea rows="8" bind:value={profileText}></textarea>
    <p class="muted small">Profile changes are saved with the global Save changes action.</p>
  </Card>
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
  .settings-stack {
    display: grid;
    gap: var(--space-5);
  }

  h2 {
    margin: 0;
    font-size: var(--text-xl);
  }

  h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  /* Subnav */
  .settings-subnav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }

  .settings-subnav a {
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    padding: 0.2rem 0.75rem;
    font-size: var(--text-sm);
    color: var(--muted-text);
    background: var(--surface-soft);
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .settings-subnav a:hover {
    background: var(--primary-soft);
    color: var(--primary);
  }

  /* Save actions */
  .save-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .unsaved-badge {
    font-size: var(--text-sm);
    color: var(--primary);
    font-weight: 500;
  }

  /* Sections */
  .section-block {
    display: grid;
    gap: var(--space-4);
  }

  .divider {
    height: 1px;
    background: var(--surface-border);
  }

  /* Feature lanes */
  .feature-lanes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-4);
  }

  .feature-lane {
    display: grid;
    gap: 0.4rem;
  }

  .feature-name {
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 600;
  }

  /* Model sections */
  .model-sections {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-4);
  }

  .model-section {
    display: grid;
    gap: var(--space-4);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: var(--surface-soft);
  }

  .model-tools {
    display: grid;
    gap: 0.3rem;
  }

  /* Form */
  label {
    display: grid;
    gap: 0.4rem;
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .field {
    display: grid;
    gap: 0.4rem;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  input:not([type='radio']):not([type='checkbox']),
  select,
  textarea {
    width: 100%;
    padding: 0.65rem 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--text-color);
    font-family: inherit;
    min-width: 0;
    max-width: 100%;
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--muted-text);
    font-weight: 400;
  }

  .two-col {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-4);
  }

  /* Lane toggle */
  .lane-toggle {
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    border: 1px solid var(--input-border);
    border-radius: var(--radius-full);
    padding: 0.2rem;
    background: var(--surface-soft);
    max-width: 360px;
    width: 100%;
  }

  .lane-toggle label {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--muted-text);
    transition: background var(--transition-fast), color var(--transition-fast);
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

  /* Keys */
  .key-block {
    display: grid;
    gap: var(--space-3);
  }

  .key-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .muted {
    color: var(--muted-text);
    margin: 0;
  }

  .small { font-size: var(--text-sm); }

  code {
    background: var(--surface-soft);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    font-size: var(--text-sm);
  }

  @media (max-width: 800px) {
    .model-sections,
    .two-col {
      grid-template-columns: 1fr;
    }
  }
</style>
