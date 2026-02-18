<script>
  import { invalidate } from '$app/navigation';
  import { onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
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
  let saveMessage = '';
  let saveError = '';

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
      const res = await apiFetch(`/api/models?provider=${provider}`);
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

  const snapshotObject = () => ({
    laneSummaries,
    laneScoring,
    laneProfileRefresh,
    laneKeyPoints,
    laneAutoTagging,
    laneArticleChat,
    laneGlobalChat,
    ingestProvider,
    ingestModel,
    ingestReasoningEffort,
    chatProvider,
    chatModel,
    chatReasoningEffort,
    summaryStyle,
    summaryLength,
    initialFeedLookbackDays: Number(initialFeedLookbackDays ?? 0),
    retentionDays: Number(retentionDays ?? 0),
    retentionMode,
    autoReadDelayMs: Number(autoReadDelayMs ?? 0),
    articleCardLayout,
    dashboardTopRatedLayout,
    dashboardTopRatedCutoff: Number(dashboardTopRatedCutoff ?? 0),
    dashboardTopRatedLimit: Number(dashboardTopRatedLimit ?? 0),
    scoreSystemPrompt,
    scoreUserPromptTemplate,
    profileText
  });

  let savedSnapshot = snapshotObject();
  let currentSnapshot = snapshotObject();
  $: currentSnapshot = {
    laneSummaries,
    laneScoring,
    laneProfileRefresh,
    laneKeyPoints,
    laneAutoTagging,
    laneArticleChat,
    laneGlobalChat,
    ingestProvider,
    ingestModel,
    ingestReasoningEffort,
    chatProvider,
    chatModel,
    chatReasoningEffort,
    summaryStyle,
    summaryLength,
    initialFeedLookbackDays: Number(initialFeedLookbackDays ?? 0),
    retentionDays: Number(retentionDays ?? 0),
    retentionMode,
    autoReadDelayMs: Number(autoReadDelayMs ?? 0),
    articleCardLayout,
    dashboardTopRatedLayout,
    dashboardTopRatedCutoff: Number(dashboardTopRatedCutoff ?? 0),
    dashboardTopRatedLimit: Number(dashboardTopRatedLimit ?? 0),
    scoreSystemPrompt,
    scoreUserPromptTemplate,
    profileText
  };
  $: hasUnsavedChanges = JSON.stringify(currentSnapshot) !== JSON.stringify(savedSnapshot);

  const applySnapshot = (snapshot) => {
    laneSummaries = snapshot.laneSummaries;
    laneScoring = snapshot.laneScoring;
    laneProfileRefresh = snapshot.laneProfileRefresh;
    laneKeyPoints = snapshot.laneKeyPoints;
    laneAutoTagging = snapshot.laneAutoTagging;
    laneArticleChat = snapshot.laneArticleChat;
    laneGlobalChat = snapshot.laneGlobalChat;
    ingestProvider = snapshot.ingestProvider;
    ingestModel = snapshot.ingestModel;
    ingestReasoningEffort = snapshot.ingestReasoningEffort;
    chatProvider = snapshot.chatProvider;
    chatModel = snapshot.chatModel;
    chatReasoningEffort = snapshot.chatReasoningEffort;
    summaryStyle = snapshot.summaryStyle;
    summaryLength = snapshot.summaryLength;
    initialFeedLookbackDays = Number(snapshot.initialFeedLookbackDays ?? 0);
    retentionDays = Number(snapshot.retentionDays ?? 0);
    retentionMode = snapshot.retentionMode;
    autoReadDelayMs = Number(snapshot.autoReadDelayMs ?? 0);
    articleCardLayout = snapshot.articleCardLayout;
    dashboardTopRatedLayout = snapshot.dashboardTopRatedLayout;
    dashboardTopRatedCutoff = Number(snapshot.dashboardTopRatedCutoff ?? 0);
    dashboardTopRatedLimit = Number(snapshot.dashboardTopRatedLimit ?? 0);
    scoreSystemPrompt = snapshot.scoreSystemPrompt;
    scoreUserPromptTemplate = snapshot.scoreUserPromptTemplate;
    profileText = snapshot.profileText;
  };

  const readApiError = async (res, fallback) => {
    const payload = await res.json().catch(() => ({}));
    return payload?.error ?? fallback;
  };

  const saveAllChanges = async () => {
    if (isSaving || !hasUnsavedChanges) return;
    isSaving = true;
    saveMessage = '';
    saveError = '';
    try {
      const settingsRes = await apiFetch('/api/settings', {
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
          initialFeedLookbackDays,
          retentionDays,
          retentionMode,
          autoReadDelayMs,
          articleCardLayout,
          dashboardTopRatedLayout,
          dashboardTopRatedCutoff,
          dashboardTopRatedLimit,
          scoreSystemPrompt,
          scoreUserPromptTemplate
        })
      });
      if (!settingsRes.ok) {
        saveError = await readApiError(settingsRes, 'Failed to save settings');
        return;
      }

      const nextProfile = profileText.trim();
      if (nextProfile) {
        const profileRes = await apiFetch('/api/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profileText: nextProfile })
        });
        if (!profileRes.ok) {
          saveError = await readApiError(profileRes, 'Failed to save profile');
          return;
        }
      }

      savedSnapshot = { ...currentSnapshot };
      saveMessage = 'Settings saved.';
      await invalidate();
    } catch {
      saveError = 'Failed to save settings';
    } finally {
      isSaving = false;
    }
  };

  const resetScorePromptDefaults = () => {
    scoreSystemPrompt = data.scorePromptDefaults.scoreSystemPrompt;
    scoreUserPromptTemplate = data.scorePromptDefaults.scoreUserPromptTemplate;
    saveMessage = '';
    saveError = '';
  };

  const discardChanges = () => {
    applySnapshot(savedSnapshot);
    saveMessage = '';
    saveError = '';
  };

  const saveKey = async (provider) => {
    const key = provider === 'openai' ? openaiKey : anthropicKey;
    if (!key) return;
    await apiFetch('/api/keys', {
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
    await apiFetch(`/api/keys/${provider}`, { method: 'DELETE' });
    setProviderModelState(provider, { models: [], error: '', fetchedAt: null });
    await invalidate();
  };

  const rotateKeys = async (provider = null) => {
    await apiFetch('/api/keys/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    await invalidate();
  };
</script>

<section class="page-header">
  <div>
    <h1>Settings</h1>
    <p>Configure AI behavior, prompts, keys, and display defaults.</p>
    <nav class="settings-subnav" aria-label="Settings sections">
      <a href="#models">AI settings</a>
      <a href="#behavior">Behavior</a>
      <a href="#fit-score">Prompts</a>
      <a href="#keys">Keys</a>
      <a href="#profile">Profile</a>
    </nav>
  </div>
  <div class="header-actions">
    {#if saveError}
      <p class="save-status error" role="status" aria-live="polite">{saveError}</p>
    {:else if saveMessage}
      <p class="save-status" role="status" aria-live="polite">{saveMessage}</p>
    {:else if hasUnsavedChanges}
      <p class="save-status muted">Unsaved changes</p>
    {/if}
    <div class="row-actions">
      <button class="ghost inline-button" on:click={discardChanges} disabled={!hasUnsavedChanges || isSaving}>
        <IconRestore size={16} stroke={1.9} />
        <span>Discard</span>
      </button>
      <button on:click={saveAllChanges} class="inline-button" disabled={!hasUnsavedChanges || isSaving}>
        <IconDeviceFloppy size={16} stroke={1.9} />
        <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
      </button>
    </div>
  </div>
</section>

<div class="settings-stack">
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

    <div class="model-sections">
      <section class="model-section" aria-label="Pipeline lane settings">
        <h3>Pipeline lane (cheaper)</h3>
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
      </section>

      <section class="model-section" aria-label="Chat lane settings">
        <h3>Chat lane (more capable)</h3>
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
      </section>
    </div>
  </div>

  <div class="card" id="behavior">
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
      Initial feed backfill window (days)
      <input
        type="number"
        min={data.initialFeedLookbackRange.min}
        max={data.initialFeedLookbackRange.max}
        step="1"
        bind:value={initialFeedLookbackDays}
      />
    </label>
    <p class="muted">
      Applies to first-time feed pulls and newly added feeds. Default {data.initialFeedLookbackRange.default} days.
      Set to 0 to include all available history.
    </p>
    <label>
      Retention window (days)
      <input
        type="number"
        min={data.retentionRange.min}
        max={data.retentionRange.max}
        step="1"
        bind:value={retentionDays}
      />
    </label>
    <div class="field">
      <div class="field-label">Retention mode</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Retention mode">
        <label class:active={retentionMode === 'archive'}>
          <input type="radio" name="retentionMode" value="archive" bind:group={retentionMode} />
          <span>Archive text</span>
        </label>
        <label class:active={retentionMode === 'delete'}>
          <input type="radio" name="retentionMode" value="delete" bind:group={retentionMode} />
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
        min={data.autoReadDelayRange.min}
        max={data.autoReadDelayRange.max}
        step="250"
        bind:value={autoReadDelayMs}
      />
    </label>
    <p class="muted">
      Applies on article detail pages. Current delay: {autoReadDelaySeconds}s. 0 means immediate. Range {data.autoReadDelayRange.min}-{data.autoReadDelayRange.max} ms.
    </p>
    <div class="field">
      <div class="field-label">Articles card layout</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Articles card layout">
        <label class:active={articleCardLayout === 'split'}>
          <input type="radio" name="articleCardLayout" value="split" bind:group={articleCardLayout} />
          <span>Split (1)</span>
        </label>
        <label class:active={articleCardLayout === 'stacked'}>
          <input type="radio" name="articleCardLayout" value="stacked" bind:group={articleCardLayout} />
          <span>Stacked (2)</span>
        </label>
      </div>
    </div>
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
    <div class="field">
      <div class="field-label">Dashboard top-rated layout</div>
      <div class="lane-toggle" role="radiogroup" aria-label="Dashboard top-rated layout">
        <label class:active={dashboardTopRatedLayout === 'split'}>
          <input type="radio" name="dashboardTopRatedLayout" value="split" bind:group={dashboardTopRatedLayout} />
          <span>Split</span>
        </label>
        <label class:active={dashboardTopRatedLayout === 'stacked'}>
          <input type="radio" name="dashboardTopRatedLayout" value="stacked" bind:group={dashboardTopRatedLayout} />
          <span>Stacked</span>
        </label>
      </div>
    </div>
    <p class="muted">
      Controls the dashboard's Top Rated section. Cutoff range {data.dashboardTopRatedRange.cutoff.min}-{data.dashboardTopRatedRange.cutoff.max}; count range {data.dashboardTopRatedRange.limit.min}-{data.dashboardTopRatedRange.limit.max}.
    </p>
  </div>

  <div class="card" id="keys">
    <h2>API Keys</h2>
    <div class="row key-rotate-row">
      <button class="ghost inline-button" on:click={() => rotateKeys()}>
        <IconRefresh size={16} stroke={1.9} />
        <span>Rotate key ciphers</span>
      </button>
    </div>
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

  <div class="card" id="fit-score">
    <h2>Prompts and profile</h2>

    <section class="card-section">
      <h3>AI fit score prompt</h3>
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
      <p class="muted">Prompt edits are saved with the global Save changes action.</p>
      <div class="row-actions">
        <button class="ghost inline-button" on:click={resetScorePromptDefaults}>
          <IconRestore size={16} stroke={1.9} />
          <span>Reset to default</span>
        </button>
      </div>
    </section>

    <div class="divider"></div>

    <section class="card-section" id="profile">
      <h3>AI preference profile</h3>
      <p class="muted">Version {data.profile.version} · Updated {new Date(data.profile.updated_at).toLocaleString()}</p>
      <textarea rows="8" bind:value={profileText}></textarea>
      <p class="muted">Profile edits are saved with the global Save changes action.</p>
    </section>
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
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .header-actions {
    display: grid;
    gap: 0.5rem;
    justify-items: end;
    min-width: min(420px, 100%);
  }

  .settings-subnav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }

  .settings-subnav a {
    border: 1px solid var(--surface-border);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    font-size: 0.82rem;
    color: var(--muted-text);
    background: var(--surface-soft);
  }

  .save-status {
    margin: 0;
    font-size: 0.85rem;
    color: var(--primary);
  }

  .save-status.error {
    color: var(--danger);
  }

  .settings-stack {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
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

  .card-section {
    display: grid;
    gap: 1rem;
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

  .field {
    display: grid;
    gap: 0.45rem;
    min-width: 0;
  }

  .field-label {
    font-size: 0.9rem;
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

  .key-rotate-row {
    margin-bottom: 0.8rem;
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

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .header-actions .row-actions {
    justify-content: flex-end;
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
    .page-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      justify-items: start;
    }

    .header-actions .row-actions {
      justify-content: flex-start;
    }

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
