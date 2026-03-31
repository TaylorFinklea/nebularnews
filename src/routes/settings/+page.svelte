<script>
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { IconPlus, IconRefresh, IconRestore, IconTrash, IconDeviceFloppy } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Button from '$lib/components/Button.svelte';
  import { showToast } from '$lib/client/toast';

  export let data;

  let laneSummaries = data.settings.featureLanes?.summaries ?? 'model_a';
  let laneScoring = data.settings.featureLanes?.scoring ?? 'model_a';
  let laneProfileRefresh = data.settings.featureLanes?.profileRefresh ?? 'model_a';
  let laneKeyPoints = data.settings.featureLanes?.keyPoints ?? 'model_a';
  let laneAutoTagging = data.settings.featureLanes?.autoTagging ?? 'model_a';
  let modelAProvider = data.settings.modelAProvider;
  let modelAModel = data.settings.modelAModel;
  let modelAReasoningEffort = data.settings.modelAReasoningEffort;
  let modelBProvider = data.settings.modelBProvider;
  let modelBModel = data.settings.modelBModel;
  let modelBReasoningEffort = data.settings.modelBReasoningEffort;
  let scoreSystemPrompt = data.settings.scoreSystemPrompt;
  let scoreUserPromptTemplate = data.settings.scoreUserPromptTemplate;
  let summaryStyle = data.settings.summaryStyle;
  let summaryLength = data.settings.summaryLength;
  let initialFeedLookbackDays = Number(data.settings.initialFeedLookbackDays ?? data.initialFeedLookbackRange?.default ?? 45);
  let maxFeedsPerPoll = Number(
    data.settings.maxFeedsPerPoll ?? data.feedPollingRange?.maxFeedsPerPoll?.default ?? 12
  );
  let maxItemsPerPoll = Number(
    data.settings.maxItemsPerPoll ?? data.feedPollingRange?.maxItemsPerPoll?.default ?? 120
  );
  let eventsPollMs = Number(data.settings.eventsPollMs ?? data.feedPollingRange?.eventsPollMs?.default ?? 15000);
  let dashboardRefreshMinMs = Number(
    data.settings.dashboardRefreshMinMs ?? data.feedPollingRange?.dashboardRefreshMinMs?.default ?? 30000
  );
  let retentionArchiveDays = Number(data.settings.retentionArchiveDays ?? data.settings.retentionDays ?? 30);
  let retentionDeleteDays = Number(data.settings.retentionDeleteDays ?? 90);
  let autoReadDelayMs = Number(data.settings.autoReadDelayMs ?? 4000);
  let taggingMethod = data.settings.taggingMethod ?? (data.settings.autoTaggingEnabled ? 'hybrid' : 'algorithmic');
  let autoTagMaxPerArticle = Number(
    data.settings.autoTagMaxPerArticle ?? data.autoTagging?.maxPerArticle?.default ?? 2
  );
  let jobProcessorBatchSize = Number(
    data.settings.jobProcessorBatchSize ?? data.jobProcessorBatchRange?.default ?? 6
  );
  let jobsIntervalMinutes = Number(
    data.settings.jobsIntervalMinutes ?? data.schedulerRange?.jobsIntervalMinutes?.default ?? 5
  );
  let pollIntervalMinutes = Number(
    data.settings.pollIntervalMinutes ?? data.schedulerRange?.pollIntervalMinutes?.default ?? 60
  );
  let pullSlicesPerTick = Number(
    data.settings.pullSlicesPerTick ?? data.schedulerRange?.pullSlicesPerTick?.default ?? 1
  );
  let pullSliceBudgetMs = Number(
    data.settings.pullSliceBudgetMs ?? data.schedulerRange?.pullSliceBudgetMs?.default ?? 8000
  );
  let jobBudgetIdleMs = Number(
    data.settings.jobBudgetIdleMs ?? data.schedulerRange?.jobBudgetIdleMs?.default ?? 8000
  );
  let jobBudgetWhilePullMs = Number(
    data.settings.jobBudgetWhilePullMs ?? data.schedulerRange?.jobBudgetWhilePullMs?.default ?? 3000
  );
  let autoQueueTodayMissing = Boolean(
    data.settings.autoQueueTodayMissing ?? data.schedulerRange?.autoQueueTodayMissingDefault ?? true
  );
  let schedulerAdvancedOpen = false;
  let schedulerApplyEnv = 'production';
  let articleCardLayout = data.settings.articleCardLayout ?? 'split';
  let dashboardQueueWindowDays = Number(
    data.settings.dashboardQueueWindowDays ?? data.dashboardQueueRange?.windowDays?.default ?? 7
  );
  let dashboardQueueLimit = Number(
    data.settings.dashboardQueueLimit ?? data.dashboardQueueRange?.limit?.default ?? 6
  );
  let dashboardQueueScoreCutoff = Number(
    data.settings.dashboardQueueScoreCutoff ?? data.dashboardQueueRange?.scoreCutoff?.default ?? 3
  );
  let newsBriefEnabled = Boolean(
    data.settings.newsBriefEnabled ?? data.newsBriefRange?.enabledDefault ?? true
  );
  let newsBriefTimezone = data.settings.newsBriefTimezone ?? data.newsBriefRange?.timezoneDefault ?? 'America/Chicago';
  let newsBriefMorningTime = data.settings.newsBriefMorningTime ?? data.newsBriefRange?.morningTimeDefault ?? '08:00';
  let newsBriefEveningTime = data.settings.newsBriefEveningTime ?? data.newsBriefRange?.eveningTimeDefault ?? '17:00';
  let newsBriefLookbackHours = Number(
    data.settings.newsBriefLookbackHours ?? data.newsBriefRange?.lookbackHours?.default ?? 48
  );
  let newsBriefScoreCutoff = Number(
    data.settings.newsBriefScoreCutoff ?? data.newsBriefRange?.scoreCutoff?.default ?? 3
  );
  let newsBriefTimezoneExplicit = Boolean(data.newsBriefMeta?.timezoneExplicit);
  let newsBriefLatestEdition = data.newsBriefLatestEdition ?? null;
  let scoringMethod = data.settings.scoringMethod ?? data.scoring?.defaults?.method ?? 'hybrid';
  let scoringAiEnhancementThreshold = Number(
    data.settings.scoringAiEnhancementThreshold ?? data.scoring?.defaults?.aiEnhancementThreshold ?? 0.5
  );
  let scoringLearningRate = Number(
    data.settings.scoringLearningRate ?? data.scoring?.defaults?.learningRate ?? 0.1
  );
  let signalWeights = data.scoring?.signalWeights ?? [];
  let isResettingWeights = false;
  let isGeneratingNewsBrief = false;
  let orphanCount = Number(data.orphanCleanup?.orphanCount ?? 0);
  let orphanSampleArticleIds = Array.isArray(data.orphanCleanup?.sampleArticleIds)
    ? data.orphanCleanup.sampleArticleIds
    : [];
  let orphanSuggestedBatchSize = Number(data.orphanCleanup?.suggestedBatchSize ?? 200);
  let orphanCleanupLoading = false;
  let orphanCleanupHasMore = orphanCount > 0;
  let orphanCleanupLastRun = null;
  let connectedApps = data.connectedApps ?? [];
  let revokingConnectedAppId = '';
  let maintenanceRunning = '';
  let maintenanceResult = '';
  $: connectedApps = data.connectedApps ?? [];
  $: autoReadDelaySeconds = (Number(autoReadDelayMs) / 1000).toFixed(2);

  let apiKeys = data.apiKeys ?? [];
  let generatingApiKey = false;
  let newApiKeyName = '';
  let generatedToken = '';
  let revokingKeyId = '';

  const generateNewApiKey = async () => {
    if (generatingApiKey) return;
    generatingApiKey = true;
    generatedToken = '';
    try {
      const res = await apiFetch('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newApiKeyName.trim() || 'API Key' })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload?.error ?? 'Failed to generate key.', 'error');
        return;
      }
      generatedToken = payload.token;
      newApiKeyName = '';
      apiKeys = [{ id: payload.id, name: payload.name, createdAt: payload.createdAt, lastUsedAt: null }, ...apiKeys];
    } catch {
      showToast('Failed to generate key.', 'error');
    } finally {
      generatingApiKey = false;
    }
  };

  const revokeApiKey = async (keyId) => {
    if (revokingKeyId) return;
    revokingKeyId = keyId;
    try {
      const res = await apiFetch(`/api/api-keys/${keyId}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast('Failed to revoke key.', 'error');
        return;
      }
      apiKeys = apiKeys.filter((k) => k.id !== keyId);
      showToast('API key revoked.', 'success');
    } catch {
      showToast('Failed to revoke key.', 'error');
    } finally {
      revokingKeyId = '';
    }
  };

  const copyToken = async () => {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      showToast('Token copied to clipboard.', 'success');
    } catch {
      showToast('Failed to copy.', 'error');
    }
  };

  let browserScrapingEnabled = Boolean(data.settings.browserScrapingEnabled);
  let browserScrapeProvider = data.settings.browserScrapeProvider ?? 'browserless';
  let browserScrapeApiUrl = data.settings.browserScrapeApiUrl ?? '';
  let browserScrapeApiKey = '';
  let browserScrapeKeyStatus = Boolean(data.keyMap.browser_scrape);
  let browserScrapeKeySaving = false;

  let openaiKey = '';
  let anthropicKey = '';
  let profileText = data.profile.profile_text;
  let keyStatus = {
    openai: Boolean(data.keyMap.openai),
    anthropic: Boolean(data.keyMap.anthropic)
  };
  let openaiModels = [];
  let anthropicModels = [];
  let openaiModelsLoading = false;
  let anthropicModelsLoading = false;
  let openaiModelsError = '';
  let anthropicModelsError = '';
  let openaiModelsFetchedAt = null;
  let anthropicModelsFetchedAt = null;
  let isSavingSettings = false;
  let isResettingDismissedSuggestions = false;
  let keyLoading = { openai: false, anthropic: false };
  let rotatingKeys = false;

  let showAdvanced = false;
  let showAdmin = false;
  let saveTimeout;

  $: keyStatus = {
    openai: Boolean(data.keyMap.openai),
    anthropic: Boolean(data.keyMap.anthropic)
  };

  const featureLaneOptions = [
    {
      label: 'Summaries',
      name: 'laneSummaries',
      get: () => laneSummaries,
      set: (value) => {
        laneSummaries = value;
      }
    },
    {
      label: 'Key Points',
      name: 'laneKeyPoints',
      get: () => laneKeyPoints,
      set: (value) => {
        laneKeyPoints = value;
      }
    },
    {
      label: 'Auto Tagging',
      name: 'laneAutoTagging',
      get: () => laneAutoTagging,
      set: (value) => {
        laneAutoTagging = value;
      }
    },
    {
      label: 'Scoring',
      name: 'laneScoring',
      get: () => laneScoring,
      set: (value) => {
        laneScoring = value;
      }
    },
    {
      label: 'Profile Refresh',
      name: 'laneProfileRefresh',
      get: () => laneProfileRefresh,
      set: (value) => {
        laneProfileRefresh = value;
      }
    },
  ];

  const clampNumber = (value, min, max, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };

  $: jobsIntervalMinutes = clampNumber(
    jobsIntervalMinutes,
    data.schedulerRange.jobsIntervalMinutes.min,
    data.schedulerRange.jobsIntervalMinutes.max,
    data.schedulerRange.jobsIntervalMinutes.default
  );
  $: pollIntervalMinutes = clampNumber(
    pollIntervalMinutes,
    data.schedulerRange.pollIntervalMinutes.min,
    data.schedulerRange.pollIntervalMinutes.max,
    data.schedulerRange.pollIntervalMinutes.default
  );
  $: pullSlicesPerTick = clampNumber(
    pullSlicesPerTick,
    data.schedulerRange.pullSlicesPerTick.min,
    data.schedulerRange.pullSlicesPerTick.max,
    data.schedulerRange.pullSlicesPerTick.default
  );
  $: pullSliceBudgetMs = clampNumber(
    pullSliceBudgetMs,
    data.schedulerRange.pullSliceBudgetMs.min,
    data.schedulerRange.pullSliceBudgetMs.max,
    data.schedulerRange.pullSliceBudgetMs.default
  );
  $: jobBudgetIdleMs = clampNumber(
    jobBudgetIdleMs,
    data.schedulerRange.jobBudgetIdleMs.min,
    data.schedulerRange.jobBudgetIdleMs.max,
    data.schedulerRange.jobBudgetIdleMs.default
  );
  $: jobBudgetWhilePullMs = clampNumber(
    jobBudgetWhilePullMs,
    data.schedulerRange.jobBudgetWhilePullMs.min,
    data.schedulerRange.jobBudgetWhilePullMs.max,
    data.schedulerRange.jobBudgetWhilePullMs.default
  );
  $: jobProcessorBatchSize = clampNumber(
    jobProcessorBatchSize,
    data.jobProcessorBatchRange.min,
    data.jobProcessorBatchRange.max,
    data.jobProcessorBatchRange.default
  );
  $: autoTagMaxPerArticle = clampNumber(
    autoTagMaxPerArticle,
    data.autoTagging?.maxPerArticle?.min ?? 1,
    data.autoTagging?.maxPerArticle?.max ?? 5,
    data.autoTagging?.maxPerArticle?.default ?? 2
  );
  $: dashboardQueueWindowDays = clampNumber(
    dashboardQueueWindowDays,
    data.dashboardQueueRange.windowDays.min,
    data.dashboardQueueRange.windowDays.max,
    data.dashboardQueueRange.windowDays.default
  );
  $: dashboardQueueLimit = clampNumber(
    dashboardQueueLimit,
    data.dashboardQueueRange.limit.min,
    data.dashboardQueueRange.limit.max,
    data.dashboardQueueRange.limit.default
  );
  $: dashboardQueueScoreCutoff = clampNumber(
    dashboardQueueScoreCutoff,
    data.dashboardQueueRange.scoreCutoff.min,
    data.dashboardQueueRange.scoreCutoff.max,
    data.dashboardQueueRange.scoreCutoff.default
  );
  $: newsBriefLookbackHours = clampNumber(
    newsBriefLookbackHours,
    data.newsBriefRange.lookbackHours.min,
    data.newsBriefRange.lookbackHours.max,
    data.newsBriefRange.lookbackHours.default
  );
  $: newsBriefScoreCutoff = clampNumber(
    newsBriefScoreCutoff,
    data.newsBriefRange.scoreCutoff.min,
    data.newsBriefRange.scoreCutoff.max,
    data.newsBriefRange.scoreCutoff.default
  );

  const schedulerDeployScript = () =>
    schedulerApplyEnv === 'production' ? 'npm run deploy:prod' : 'npm run deploy:staging';

  $: schedulerApplyCommand = `npm run ${
    schedulerApplyEnv === 'production' ? 'scheduler:apply:prod' : 'scheduler:apply:staging'
  } -- --jobs-interval ${jobsIntervalMinutes} --poll-interval ${pollIntervalMinutes} && ${schedulerDeployScript()}`;

  $: schedulerMode =
    jobProcessorBatchSize * pullSlicesPerTick * (jobBudgetIdleMs / 1000) <= 60
      ? 'Conservative'
      : jobProcessorBatchSize * pullSlicesPerTick * (jobBudgetIdleMs / 1000) <= 160
        ? 'Balanced'
        : 'Aggressive';

  const schedulerPresets = [
    {
      id: 'conservative',
      label: 'Conservative',
      description: 'Lower throughput, lowest risk of Worker limit spikes.',
      values: {
        jobProcessorBatchSize: 4,
        pullSlicesPerTick: 1,
        jobBudgetIdleMs: 4000,
        jobBudgetWhilePullMs: 1500,
        pullSliceBudgetMs: 6000,
        jobsIntervalMinutes: 10,
        pollIntervalMinutes: 60
      }
    },
    {
      id: 'balanced',
      label: 'Balanced',
      description: 'Good default throughput while staying resource-aware.',
      values: {
        jobProcessorBatchSize: 6,
        pullSlicesPerTick: 1,
        jobBudgetIdleMs: 8000,
        jobBudgetWhilePullMs: 3000,
        pullSliceBudgetMs: 8000,
        jobsIntervalMinutes: 5,
        pollIntervalMinutes: 60
      }
    },
    {
      id: 'aggressive',
      label: 'Aggressive',
      description: 'Higher throughput with higher chance of resource pressure.',
      values: {
        jobProcessorBatchSize: 10,
        pullSlicesPerTick: 2,
        jobBudgetIdleMs: 12000,
        jobBudgetWhilePullMs: 4500,
        pullSliceBudgetMs: 12000,
        jobsIntervalMinutes: 3,
        pollIntervalMinutes: 30
      }
    }
  ];

  const matchesSchedulerPreset = (preset) =>
    jobProcessorBatchSize === preset.values.jobProcessorBatchSize &&
    pullSlicesPerTick === preset.values.pullSlicesPerTick &&
    jobBudgetIdleMs === preset.values.jobBudgetIdleMs &&
    jobBudgetWhilePullMs === preset.values.jobBudgetWhilePullMs &&
    pullSliceBudgetMs === preset.values.pullSliceBudgetMs &&
    jobsIntervalMinutes === preset.values.jobsIntervalMinutes &&
    pollIntervalMinutes === preset.values.pollIntervalMinutes;

  $: activeSchedulerPreset = schedulerPresets.find((preset) => matchesSchedulerPreset(preset))?.id ?? 'custom';
  $: activeSchedulerPresetLabel =
    schedulerPresets.find((preset) => preset.id === activeSchedulerPreset)?.label ?? 'Custom';

  const applySchedulerPreset = (presetId) => {
    const preset = schedulerPresets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    jobProcessorBatchSize = preset.values.jobProcessorBatchSize;
    pullSlicesPerTick = preset.values.pullSlicesPerTick;
    jobBudgetIdleMs = preset.values.jobBudgetIdleMs;
    jobBudgetWhilePullMs = preset.values.jobBudgetWhilePullMs;
    pullSliceBudgetMs = preset.values.pullSliceBudgetMs;
    jobsIntervalMinutes = preset.values.jobsIntervalMinutes;
    pollIntervalMinutes = preset.values.pollIntervalMinutes;
    autoSave();
  };

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

  /* ─── Save logic (immediate per-field) ─────────────── */

  const saveSettings = async () => {
    isSavingSettings = true;
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
            autoTagging: laneAutoTagging
          },
          modelAProvider,
          modelAModel,
          modelAReasoningEffort,
          modelBProvider,
          modelBModel,
          modelBReasoningEffort,
          summaryStyle,
          summaryLength,
          initialFeedLookbackDays,
          maxFeedsPerPoll,
          maxItemsPerPoll,
          eventsPollMs,
          dashboardRefreshMinMs,
          retentionArchiveDays,
          retentionDeleteDays,
          autoReadDelayMs,
          taggingMethod,
          autoTagMaxPerArticle,
          jobProcessorBatchSize,
          jobsIntervalMinutes,
          pollIntervalMinutes,
          pullSlicesPerTick,
          pullSliceBudgetMs,
          jobBudgetIdleMs,
          jobBudgetWhilePullMs,
          autoQueueTodayMissing,
          articleCardLayout,
          dashboardQueueWindowDays,
          dashboardQueueLimit,
          dashboardQueueScoreCutoff,
          newsBriefEnabled,
          newsBriefTimezone,
          newsBriefMorningTime,
          newsBriefEveningTime,
          newsBriefLookbackHours,
          newsBriefScoreCutoff,
          scoreSystemPrompt,
          scoreUserPromptTemplate,
          scoringMethod,
          scoringAiEnhancementThreshold,
          scoringLearningRate
        })
      });
      if (!settingsRes.ok) {
        throw new Error(await readApiError(settingsRes, 'Failed to save settings'));
      }

      const nextProfile = profileText.trim();
      if (nextProfile) {
        const profileRes = await apiFetch('/api/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profileText: nextProfile })
        });
        if (!profileRes.ok) {
          throw new Error(await readApiError(profileRes, 'Failed to save profile'));
        }
      }

      await invalidateAll();
    } finally {
      isSavingSettings = false;
    }
  };

  const autoSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        await saveSettings();
        showToast('Settings saved', 'success', 2000);
      } catch {
        showToast('Failed to save', 'error');
      }
    }, 500);
  };

  const resetScoringWeights = async () => {
    if (isResettingWeights) return;
    isResettingWeights = true;
    try {
      const res = await apiFetch('/api/settings/scoring/reset', {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (res.ok) {
        const result = await res.json();
        signalWeights = result.signalWeights ?? [];
        showToast('Scoring weights reset to defaults.', 'success');
      } else {
        showToast('Failed to reset scoring weights.', 'error');
      }
    } catch {
      showToast('Failed to reset scoring weights.', 'error');
    } finally {
      isResettingWeights = false;
    }
  };

  const generateNewsBriefNow = async () => {
    if (isGeneratingNewsBrief) return;
    isGeneratingNewsBrief = true;
    try {
      const res = await apiFetch('/api/settings/news-brief/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to generate News Brief.'), 'error');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      const edition = payload?.edition ?? {};
      const candidateCount = Number(edition?.candidateCount ?? 0);
      const status = String(edition?.status ?? 'ready');
      newsBriefLatestEdition = {
        ...(newsBriefLatestEdition ?? {}),
        status,
        generatedAt: edition?.generatedAt ?? null,
        candidateCount
      };
      showToast(
        status === 'empty'
          ? 'News Brief generated with no qualifying developments.'
          : `News Brief generated from ${candidateCount} candidate article${candidateCount === 1 ? '' : 's'}.`,
        'success'
      );
      await invalidateAll();
    } catch {
      showToast('Failed to generate News Brief.', 'error');
    } finally {
      isGeneratingNewsBrief = false;
    }
  };

  const appKindLabel = (clientKind) => {
    if (clientKind === 'mobile') return 'iOS companion';
    if (clientKind === 'mcp') return 'MCP';
    return 'OAuth';
  };

  const revokeConnectedApp = async (clientId) => {
    if (!clientId || revokingConnectedAppId) return;
    revokingConnectedAppId = clientId;
    try {
      const res = await apiFetch(`/api/settings/oauth-clients/${encodeURIComponent(clientId)}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to revoke connected app.'), 'error');
        return;
      }
      showToast('Connected app access revoked.', 'success');
      await invalidateAll();
    } catch {
      showToast('Failed to revoke connected app.', 'error');
    } finally {
      revokingConnectedAppId = '';
    }
  };

  const readApiError = async (res, fallback) => {
    const payload = await res.json().catch(() => ({}));
    return payload?.error?.message ?? payload?.error ?? fallback;
  };

  const readApiData = (payload) => payload?.data ?? payload ?? {};

  const setKeyLoading = (provider, nextValue) => {
    keyLoading = { ...keyLoading, [provider]: nextValue };
  };

  const resetScorePromptDefaults = () => {
    scoreSystemPrompt = data.scorePromptDefaults.scoreSystemPrompt;
    scoreUserPromptTemplate = data.scorePromptDefaults.scoreUserPromptTemplate;
    autoSave();
  };

  const resetDismissedTagSuggestions = async () => {
    if (isResettingDismissedSuggestions) return;
    isResettingDismissedSuggestions = true;
    try {
      const res = await apiFetch('/api/settings/tag-suggestions/reset-dismissed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to reset dismissed AI tag suggestions'), 'error');
        return;
      }
      showToast('Dismissed AI tag suggestions reset.', 'success');
    } catch {
      showToast('Failed to reset dismissed AI tag suggestions', 'error');
    } finally {
      isResettingDismissedSuggestions = false;
    }
  };

  const refreshOrphanPreview = async () => {
    if (orphanCleanupLoading) return;
    orphanCleanupLoading = true;
    try {
      const res = await apiFetch('/api/admin/orphans/preview');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload?.error?.message ?? payload?.error ?? 'Failed to load orphan preview', 'error');
        return;
      }
      const summary = readApiData(payload);
      orphanCount = Number(summary?.orphan_count ?? 0);
      orphanSampleArticleIds = Array.isArray(summary?.sample_article_ids) ? summary.sample_article_ids : [];
      orphanSuggestedBatchSize = Number(summary?.suggested_batch_size ?? orphanSuggestedBatchSize ?? 200);
      orphanCleanupHasMore = orphanCount > 0;
      showToast('Orphan preview updated.', 'success');
    } catch {
      showToast('Failed to load orphan preview', 'error');
    } finally {
      orphanCleanupLoading = false;
    }
  };

  const runOrphanCleanup = async () => {
    if (orphanCleanupLoading) return;
    orphanCleanupLoading = true;
    try {
      const res = await apiFetch('/api/admin/orphans/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: orphanSuggestedBatchSize, dry_run: false })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload?.error?.message ?? payload?.error ?? 'Failed to run orphan cleanup', 'error');
        return;
      }
      const summary = readApiData(payload);
      orphanCleanupLastRun = summary;
      orphanCount = Number(summary?.orphan_count_after ?? orphanCount);
      orphanCleanupHasMore = Boolean(summary?.has_more);
      showToast(
        `Cleaned ${Number(summary?.deleted_articles ?? 0)} orphan article${Number(summary?.deleted_articles ?? 0) === 1 ? '' : 's'}.`,
        'success'
      );
    } catch {
      showToast('Failed to run orphan cleanup', 'error');
    } finally {
      orphanCleanupLoading = false;
    }
  };

  const runBackfillKeyPoints = async () => {
    maintenanceRunning = 'key_points';
    maintenanceResult = '';
    try {
      const res = await apiFetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'backfill_key_points' })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload?.error?.message ?? 'Failed to backfill key points', 'error');
        return;
      }
      const result = readApiData(payload);
      const queued = Number(result?.queued ?? 0);
      maintenanceResult = `Queued ${queued} key point job${queued === 1 ? '' : 's'}. They will process on the next queue cycle.`;
      showToast(maintenanceResult, 'success');
    } catch {
      showToast('Failed to backfill key points', 'error');
    } finally {
      maintenanceRunning = '';
    }
  };

  const runRefetchContent = async () => {
    maintenanceRunning = 'refetch';
    maintenanceResult = '';
    try {
      const res = await apiFetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'refetch_missing_content' })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(payload?.error?.message ?? 'Failed to queue content re-fetch', 'error');
        return;
      }
      const result = readApiData(payload);
      const queued = Number(result?.queued ?? 0);
      maintenanceResult = `Queued ${queued} content re-fetch job${queued === 1 ? '' : 's'}. They will process on the next queue cycle.`;
      showToast(maintenanceResult, 'success');
    } catch {
      showToast('Failed to queue content re-fetch', 'error');
    } finally {
      maintenanceRunning = '';
    }
  };

  const copySchedulerCommand = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      showToast('Clipboard is unavailable in this browser.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(schedulerApplyCommand);
      showToast('Scheduler apply command copied.', 'success');
    } catch {
      showToast('Failed to copy scheduler command.', 'error');
    }
  };

  const saveKey = async (provider) => {
    if (keyLoading[provider]) return;
    const key = provider === 'openai' ? openaiKey : anthropicKey;
    if (!key) return;
    setKeyLoading(provider, true);
    try {
      const res = await apiFetch('/api/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: key })
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to save provider key'), 'error');
        return;
      }
      if (provider === 'openai') {
        openaiKey = '';
      } else {
        anthropicKey = '';
      }
      keyStatus = { ...keyStatus, [provider]: true };
      showToast(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key saved.`, 'success');
      await invalidateAll();
      await syncModels(provider);
    } catch {
      showToast('Failed to save provider key', 'error');
    } finally {
      setKeyLoading(provider, false);
    }
  };

  const removeKey = async (provider) => {
    if (keyLoading[provider]) return;
    setKeyLoading(provider, true);
    try {
      const res = await apiFetch(`/api/keys/${provider}`, { method: 'DELETE' });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to remove provider key'), 'error');
        return;
      }
      setProviderModelState(provider, { models: [], error: '', fetchedAt: null });
      keyStatus = { ...keyStatus, [provider]: false };
      showToast(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} key removed.`, 'success');
      await invalidateAll();
    } catch {
      showToast('Failed to remove provider key', 'error');
    } finally {
      setKeyLoading(provider, false);
    }
  };

  const saveBrowserScrapeKey = async () => {
    if (!browserScrapeApiKey || browserScrapeKeySaving) return;
    browserScrapeKeySaving = true;
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ browserScrapeApiKey })
      });
      if (!res.ok) {
        showToast('Failed to save scraper key', 'error');
        return;
      }
      browserScrapeApiKey = '';
      browserScrapeKeyStatus = true;
      showToast('Scraper API key saved.', 'success');
    } catch {
      showToast('Failed to save scraper key', 'error');
    } finally {
      browserScrapeKeySaving = false;
    }
  };

  const removeBrowserScrapeKey = async () => {
    if (browserScrapeKeySaving) return;
    browserScrapeKeySaving = true;
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ browserScrapeApiKey: null })
      });
      if (!res.ok) {
        showToast('Failed to remove scraper key', 'error');
        return;
      }
      browserScrapeKeyStatus = false;
      showToast('Scraper API key removed.', 'success');
    } catch {
      showToast('Failed to remove scraper key', 'error');
    } finally {
      browserScrapeKeySaving = false;
    }
  };

  const rotateKeys = async (provider = null) => {
    if (rotatingKeys) return;
    rotatingKeys = true;
    try {
      const res = await apiFetch('/api/keys/rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider })
      });
      if (!res.ok) {
        showToast(await readApiError(res, 'Failed to rotate ciphers'), 'error');
        return;
      }
      showToast('Keys rotated.', 'success');
      await invalidateAll();
    } catch {
      showToast('Failed to rotate ciphers', 'error');
    } finally {
      rotatingKeys = false;
    }
  };

  onMount(() => {
    if (!newsBriefTimezoneExplicit && typeof Intl !== 'undefined') {
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserTimezone) {
        newsBriefTimezone = browserTimezone;
      }
    }

    if (keyStatus.openai) void syncModels('openai', { silent: true });
    if (keyStatus.anthropic) void syncModels('anthropic', { silent: true });

    return undefined;
  });
</script>

<PageHeader
  title="Settings"
  description="Configure AI behavior, reading defaults, provider access, and operational controls."
/>

<div class="settings-quick-links">
  <a href="/jobs" class="quick-link">Jobs</a>
  <a href="/tags" class="quick-link">Tags</a>
  <a href="/feeds" class="quick-link">Feeds</a>
</div>

<div class="settings-page">
  <!-- ═══════════════════════════════════════════════════
       TIER 1 — Essential (always visible)
       ═══════════════════════════════════════════════════ -->
  <div class="settings-card">
    <!-- AI Models -->
    <div class="settings-section-title">AI Models</div>

    <div class="settings-row">
      <label class="row-label">Model A</label>
      <select bind:value={modelAProvider} on:change={autoSave}>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <input
        bind:value={modelAModel}
        placeholder="gpt-4o-mini"
        list={modelAProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
        on:input={autoSave}
      />
      <Button
        variant="ghost"
        size="inline"
        on:click={() => syncModels(modelAProvider)}
        disabled={isLoadingModels(modelAProvider)}
      >
        <IconRefresh size={14} stroke={1.9} />
      </Button>
    </div>

    <div class="settings-row">
      <label class="row-label">Model B</label>
      <select bind:value={modelBProvider} on:change={autoSave}>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <input
        bind:value={modelBModel}
        placeholder="gpt-4o"
        list={modelBProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
        on:input={autoSave}
      />
      <Button
        variant="ghost"
        size="inline"
        on:click={() => syncModels(modelBProvider)}
        disabled={isLoadingModels(modelBProvider)}
      >
        <IconRefresh size={14} stroke={1.9} />
      </Button>
    </div>

    <!-- Content -->
    <div class="settings-section-title">Content</div>

    <div class="settings-row">
      <label class="row-label">Summary style</label>
      <select bind:value={summaryStyle} on:change={autoSave}>
        <option value="concise">Concise</option>
        <option value="detailed">Detailed</option>
        <option value="bullet">Bullet-heavy</option>
      </select>
      <label class="row-label">Length</label>
      <select bind:value={summaryLength} on:change={autoSave}>
        <option value="short">Short</option>
        <option value="medium">Medium</option>
        <option value="long">Long</option>
      </select>
    </div>

    <div class="settings-row">
      <label class="row-label">Scoring</label>
      <select bind:value={scoringMethod} on:change={autoSave}>
        <option value="algorithmic">Algorithmic</option>
        <option value="hybrid">Hybrid</option>
        <option value="ai">AI only</option>
      </select>
      <label class="row-label">Tagging</label>
      <select bind:value={taggingMethod} on:change={autoSave}>
        <option value="algorithmic">Algorithmic</option>
        <option value="hybrid">Hybrid</option>
      </select>
    </div>

    <!-- Dashboard -->
    <div class="settings-section-title">Dashboard</div>

    <div class="settings-row">
      <label class="row-label">Queue count</label>
      <input
        type="number"
        min={data.dashboardQueueRange.limit.min}
        max={data.dashboardQueueRange.limit.max}
        step="1"
        bind:value={dashboardQueueLimit}
        on:input={autoSave}
      />
      <label class="row-label">High-fit cutoff</label>
      <input
        type="number"
        min={data.dashboardQueueRange.scoreCutoff.min}
        max={data.dashboardQueueRange.scoreCutoff.max}
        step="1"
        bind:value={dashboardQueueScoreCutoff}
        on:input={autoSave}
      />
    </div>

    <div class="settings-row">
      <label class="row-label">News Brief</label>
      <label class="toggle-label">
        <input type="checkbox" bind:checked={newsBriefEnabled} on:change={autoSave} />
        <span>Enabled</span>
      </label>
    </div>

    <!-- Retention -->
    <div class="settings-section-title">Retention</div>

    <div class="settings-row">
      <label class="row-label">Archive after</label>
      <input
        type="number"
        min={data.retentionRange.min}
        max={data.retentionRange.max}
        step="1"
        bind:value={retentionArchiveDays}
        on:input={autoSave}
      />
      <span class="unit">days</span>
      <label class="row-label">Delete after</label>
      <input
        type="number"
        min={data.retentionRange.min}
        max={data.retentionRange.max}
        step="1"
        bind:value={retentionDeleteDays}
        on:input={autoSave}
      />
      <span class="unit">days</span>
    </div>
    <p class="hint">Saved articles are never touched. 0 disables.</p>
  </div>

  <!-- ═══════════════════════════════════════════════════
       TIER 2 — Advanced (collapsible)
       ═══════════════════════════════════════════════════ -->
  <button type="button" class="settings-toggle" on:click={() => (showAdvanced = !showAdvanced)}>
    {showAdvanced ? 'Hide' : 'Show'} advanced settings
  </button>

  {#if showAdvanced}
    <div class="settings-card">
      <!-- Feature lanes -->
      <div class="settings-section-title">Feature lanes</div>
      <div class="feature-lanes">
        {#each featureLaneOptions as feature}
          <div class="feature-lane">
            <div class="feature-name">{feature.label}</div>
            <div class="lane-toggle" role="radiogroup" aria-label={`${feature.label} lane`}>
              <label class:active={feature.get() === 'model_a'}>
                <input
                  type="radio"
                  name={feature.name}
                  value="model_a"
                  checked={feature.get() === 'model_a'}
                  on:change={() => { feature.set('model_a'); autoSave(); }}
                />
                <span>Model A</span>
              </label>
              <label class:active={feature.get() === 'model_b'}>
                <input
                  type="radio"
                  name={feature.name}
                  value="model_b"
                  checked={feature.get() === 'model_b'}
                  on:change={() => { feature.set('model_b'); autoSave(); }}
                />
                <span>Model B</span>
              </label>
            </div>
          </div>
        {/each}
      </div>

      <!-- Reasoning effort -->
      <div class="settings-section-title">Reasoning effort</div>
      <div class="settings-row">
        <label class="row-label">Model A</label>
        <select bind:value={modelAReasoningEffort} on:change={autoSave}>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <label class="row-label">Model B</label>
        <select bind:value={modelBReasoningEffort} on:change={autoSave}>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <!-- Scoring tuning -->
      <div class="settings-section-title">Scoring tuning</div>
      {#if scoringMethod === 'hybrid'}
        <div class="settings-row">
          <label class="row-label">AI enhancement threshold</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={scoringAiEnhancementThreshold}
            on:input={autoSave}
          />
          <span class="hint">{scoringAiEnhancementThreshold.toFixed(2)}</span>
        </div>
      {/if}
      <div class="settings-row">
        <label class="row-label">Learning rate</label>
        <input
          type="range"
          min="0.01"
          max="0.5"
          step="0.01"
          bind:value={scoringLearningRate}
          on:input={autoSave}
        />
        <span class="hint">{scoringLearningRate.toFixed(2)}</span>
      </div>

      <div class="subsection">
        <div class="split-header">
          <div class="subsection-header">
            <h3>Signal weights</h3>
            <p class="muted">Learned from your reactions. Higher = more influence.</p>
          </div>
          <Button
            variant="ghost"
            size="inline"
            on:click={resetScoringWeights}
            disabled={isResettingWeights}
          >
            <IconRestore size={14} stroke={1.9} />
            <span>{isResettingWeights ? 'Resetting...' : 'Reset to defaults'}</span>
          </Button>
        </div>

        {#if signalWeights.length > 0}
          <div class="signal-weights-table">
            <div class="signal-header">
              <span>Signal</span>
              <span>Weight</span>
              <span>Samples</span>
            </div>
            {#each signalWeights as sw}
              <div class="signal-row">
                <span class="signal-name">{sw.name.replace(/_/g, ' ')}</span>
                <span class="signal-weight">
                  <span class="weight-bar" style="width: {Math.min(100, (sw.weight / 2) * 100)}%"></span>
                  <span class="weight-value">{sw.weight.toFixed(2)}</span>
                </span>
                <span class="signal-samples">{sw.sampleCount}</span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="muted small">No signal weights loaded.</p>
        {/if}
      </div>

      <!-- Scoring QA -->
      <div class="settings-section-title">Scoring QA</div>
      <div class="qa-grid">
        <div class="qa-card">
          <span class="qa-label">Score status</span>
          <strong>{data.scoringObservability?.scoreStatusCounts?.ready ?? 0} ready</strong>
          <span class="muted small">{data.scoringObservability?.scoreStatusCounts?.insufficientSignal ?? 0} learning</span>
        </div>
        <div class="qa-card">
          <span class="qa-label">Confidence buckets</span>
          <strong>
            {data.scoringObservability?.confidenceBuckets?.low ?? 0} low ·
            {data.scoringObservability?.confidenceBuckets?.medium ?? 0} medium ·
            {data.scoringObservability?.confidenceBuckets?.high ?? 0} high
          </strong>
        </div>
        <div class="qa-card">
          <span class="qa-label">Tag sources</span>
          <strong>
            {data.scoringObservability?.tagSourceCounts?.manual ?? 0} manual ·
            {data.scoringObservability?.tagSourceCounts?.system ?? 0} system ·
            {data.scoringObservability?.tagSourceCounts?.ai ?? 0} AI
          </strong>
        </div>
        <div class="qa-card">
          <span class="qa-label">Recent tag coverage</span>
          <strong>{data.scoringObservability?.recentCoverage?.taggedArticlePercent ?? 0}% tagged</strong>
          <span class="muted small">Last {data.scoringObservability?.recentCoverage?.windowDays ?? 30} days</span>
        </div>
        <div class="qa-card">
          <span class="qa-label">Preference-backed scores</span>
          <strong>{data.scoringObservability?.recentCoverage?.preferenceBackedScorePercent ?? 0}%</strong>
          <span class="muted small">
            {data.scoringObservability?.recentCoverage?.recentScoredArticles ?? 0} scored
          </span>
        </div>
        <div class="qa-card">
          <span class="qa-label">Missing jobs</span>
          <strong>
            {data.scoringObservability?.recentJobCoverage?.missingScoreJobs ?? 0} score ·
            {data.scoringObservability?.recentJobCoverage?.missingAutoTagJobs ?? 0} tag ·
            {data.scoringObservability?.recentJobCoverage?.missingImageBackfillJobs ?? 0} image
          </strong>
          <span class="muted small">
            Last {data.scoringObservability?.recentJobCoverage?.windowHours ?? 24}h
          </span>
        </div>
      </div>

      <!-- News Brief schedule -->
      <div class="settings-section-title">News Brief schedule</div>
      <div class="settings-row">
        <label class="row-label">Timezone</label>
        <input bind:value={newsBriefTimezone} placeholder="America/Chicago" on:input={autoSave} />
      </div>
      <div class="settings-row">
        <label class="row-label">Morning</label>
        <input bind:value={newsBriefMorningTime} placeholder="08:00" on:input={autoSave} />
        <label class="row-label">Evening</label>
        <input bind:value={newsBriefEveningTime} placeholder="17:00" on:input={autoSave} />
      </div>
      <div class="settings-row">
        <label class="row-label">Lookback (hours)</label>
        <input
          type="number"
          min={data.newsBriefRange.lookbackHours.min}
          max={data.newsBriefRange.lookbackHours.max}
          step="1"
          bind:value={newsBriefLookbackHours}
          on:input={autoSave}
        />
        <label class="row-label">Min fit score</label>
        <input
          type="number"
          min={data.newsBriefRange.scoreCutoff.min}
          max={data.newsBriefRange.scoreCutoff.max}
          step="1"
          bind:value={newsBriefScoreCutoff}
          on:input={autoSave}
        />
      </div>
      <div class="settings-row">
        <Button
          variant="ghost"
          size="inline"
          on:click={generateNewsBriefNow}
          disabled={isGeneratingNewsBrief}
        >
          <IconRefresh size={14} stroke={1.9} />
          <span>{isGeneratingNewsBrief ? 'Generating...' : 'Generate now'}</span>
        </Button>
        {#if newsBriefLatestEdition}
          <span class="hint">
            Latest: {newsBriefLatestEdition.editionLabel ?? 'Update'} · {newsBriefLatestEdition.status}
            {#if newsBriefLatestEdition.generatedAt}
              · {new Date(newsBriefLatestEdition.generatedAt).toLocaleString()}
            {/if}
          </span>
        {/if}
      </div>

      <!-- Auto-read delay -->
      <div class="settings-section-title">Reading</div>
      <div class="settings-row">
        <label class="row-label">Mark read after (ms)</label>
        <input
          type="number"
          min={data.autoReadDelayRange.min}
          max={data.autoReadDelayRange.max}
          step="250"
          bind:value={autoReadDelayMs}
          on:input={autoSave}
        />
        <span class="hint">{autoReadDelaySeconds}s</span>
      </div>

      <!-- Article card layout -->
      <div class="settings-row">
        <label class="row-label">Card layout</label>
        <div class="lane-toggle" role="radiogroup" aria-label="Article card layout">
          <label class:active={articleCardLayout === 'split'}>
            <input type="radio" name="articleCardLayout" value="split" bind:group={articleCardLayout} on:change={autoSave} />
            <span>Split</span>
          </label>
          <label class:active={articleCardLayout === 'stacked'}>
            <input type="radio" name="articleCardLayout" value="stacked" bind:group={articleCardLayout} on:change={autoSave} />
            <span>Stacked</span>
          </label>
        </div>
      </div>

      <!-- Feed intake -->
      <div class="settings-section-title">Feed intake</div>
      <div class="settings-row">
        <label class="row-label">Initial backfill (days)</label>
        <input
          type="number"
          min={data.initialFeedLookbackRange.min}
          max={data.initialFeedLookbackRange.max}
          step="1"
          bind:value={initialFeedLookbackDays}
          on:input={autoSave}
        />
        <label class="row-label">Max feeds</label>
        <input
          type="number"
          min={data.feedPollingRange.maxFeedsPerPoll.min}
          max={data.feedPollingRange.maxFeedsPerPoll.max}
          step="1"
          bind:value={maxFeedsPerPoll}
          on:input={autoSave}
        />
      </div>
      <div class="settings-row">
        <label class="row-label">Max items per poll</label>
        <input
          type="number"
          min={data.feedPollingRange.maxItemsPerPoll.min}
          max={data.feedPollingRange.maxItemsPerPoll.max}
          step="1"
          bind:value={maxItemsPerPoll}
          on:input={autoSave}
        />
        <label class="row-label">Events poll (ms)</label>
        <input
          type="number"
          min={data.feedPollingRange.eventsPollMs.min}
          max={data.feedPollingRange.eventsPollMs.max}
          step="1000"
          bind:value={eventsPollMs}
          on:input={autoSave}
        />
      </div>
      <div class="settings-row">
        <label class="row-label">Dashboard refresh (ms)</label>
        <input
          type="number"
          min={data.feedPollingRange.dashboardRefreshMinMs.min}
          max={data.feedPollingRange.dashboardRefreshMinMs.max}
          step="1000"
          bind:value={dashboardRefreshMinMs}
          on:input={autoSave}
        />
      </div>

      <!-- Tagging extras -->
      <div class="settings-section-title">Tagging</div>
      <div class="settings-row">
        <label class="row-label">Max tags per article</label>
        <input
          type="number"
          min={data.autoTagging?.maxPerArticle?.min ?? 1}
          max={data.autoTagging?.maxPerArticle?.max ?? 5}
          step="1"
          bind:value={autoTagMaxPerArticle}
          on:input={autoSave}
        />
        <Button
          variant="ghost"
          size="inline"
          on:click={resetDismissedTagSuggestions}
          disabled={isResettingDismissedSuggestions}
        >
          <IconRefresh size={14} stroke={1.9} />
          <span>{isResettingDismissedSuggestions ? 'Resetting...' : 'Reset dismissed'}</span>
        </Button>
      </div>

      <!-- Prompts -->
      <div class="settings-section-title">Prompts</div>
      <div class="subsection">
        <div class="subsection-header">
          <h3>AI preference profile</h3>
          <p class="muted">
            Version {data.profile.version} · Updated {new Date(data.profile.updated_at).toLocaleString()}
          </p>
        </div>
        <textarea rows="8" bind:value={profileText} on:input={autoSave}></textarea>
      </div>

      <div class="subsection">
        <div class="split-header">
          <div class="subsection-header">
            <h3>AI fit score prompts</h3>
            <p class="muted">
              Variables: <code>{'{{profile}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{url}}'}</code>,
              <code>{'{{content}}'}</code>.
            </p>
          </div>
          <Button variant="ghost" size="inline" on:click={resetScorePromptDefaults}>
            <IconRestore size={14} stroke={1.9} />
            <span>Reset defaults</span>
          </Button>
        </div>
        <label>
          System prompt
          <textarea rows="4" bind:value={scoreSystemPrompt} on:input={autoSave}></textarea>
        </label>
        <label>
          User prompt template
          <textarea rows="12" bind:value={scoreUserPromptTemplate} on:input={autoSave}></textarea>
        </label>
      </div>

      <!-- Dashboard queue window -->
      <div class="settings-section-title">Dashboard queue window</div>
      <div class="settings-row">
        <label class="row-label">Window (days)</label>
        <input
          type="number"
          min={data.dashboardQueueRange.windowDays.min}
          max={data.dashboardQueueRange.windowDays.max}
          step="1"
          bind:value={dashboardQueueWindowDays}
          on:input={autoSave}
        />
      </div>

      <!-- Maintenance buttons -->
      <div class="settings-section-title">Maintenance</div>
      <div class="settings-row">
        <button
          type="button"
          class="action-btn"
          disabled={maintenanceRunning}
          on:click={runBackfillKeyPoints}
        >
          {maintenanceRunning === 'key_points' ? 'Running...' : 'Backfill key points'}
        </button>
        <button
          type="button"
          class="action-btn"
          disabled={maintenanceRunning}
          on:click={runRefetchContent}
        >
          {maintenanceRunning === 'refetch' ? 'Running...' : 'Re-fetch missing content'}
        </button>
      </div>
      {#if maintenanceResult}
        <p class="hint">{maintenanceResult}</p>
      {/if}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════
       TIER 3 — Admin (collapsible)
       ═══════════════════════════════════════════════════ -->
  <button type="button" class="settings-toggle" on:click={() => (showAdmin = !showAdmin)}>
    {showAdmin ? 'Hide' : 'Show'} admin settings
  </button>

  {#if showAdmin}
    <div class="settings-card">
      <!-- API Keys -->
      <div class="settings-section-title">API Keys</div>
      <div class="split-header">
        <p class="muted">Stored server-side for model sync and runtime requests.</p>
        <Button variant="ghost" size="inline" on:click={() => rotateKeys()} disabled={rotatingKeys}>
          <IconRefresh size={14} stroke={1.9} />
          <span>{rotatingKeys ? 'Rotating...' : 'Rotate ciphers'}</span>
        </Button>
      </div>

      <div class="key-provider-grid">
        <div class="subsection soft-panel">
          <div class="key-provider-header">
            <div>
              <h3>OpenAI</h3>
              <p class="muted small">{keyStatus.openai ? 'Key stored' : 'No key yet'}</p>
            </div>
            <Button
              variant="danger"
              size="icon"
              on:click={() => removeKey('openai')}
              disabled={!keyStatus.openai || keyLoading.openai}
              title="Remove OpenAI key"
            >
              <IconTrash size={15} stroke={1.9} />
            </Button>
          </div>
          <input type="password" placeholder="Paste OpenAI key" bind:value={openaiKey} />
          <Button size="inline" on:click={() => saveKey('openai')} disabled={!openaiKey || keyLoading.openai}>
            <IconDeviceFloppy size={15} stroke={1.9} />
            <span>{keyLoading.openai ? 'Saving...' : 'Save OpenAI key'}</span>
          </Button>
        </div>

        <div class="subsection soft-panel">
          <div class="key-provider-header">
            <div>
              <h3>Anthropic</h3>
              <p class="muted small">{keyStatus.anthropic ? 'Key stored' : 'No key yet'}</p>
            </div>
            <Button
              variant="danger"
              size="icon"
              on:click={() => removeKey('anthropic')}
              disabled={!keyStatus.anthropic || keyLoading.anthropic}
              title="Remove Anthropic key"
            >
              <IconTrash size={15} stroke={1.9} />
            </Button>
          </div>
          <input type="password" placeholder="Paste Anthropic key" bind:value={anthropicKey} />
          <Button
            size="inline"
            on:click={() => saveKey('anthropic')}
            disabled={!anthropicKey || keyLoading.anthropic}
          >
            <IconDeviceFloppy size={15} stroke={1.9} />
            <span>{keyLoading.anthropic ? 'Saving...' : 'Save Anthropic key'}</span>
          </Button>
        </div>
      </div>

      <!-- Browser Scraping -->
      <div class="settings-section-title">Browser Scraping</div>
      <p class="muted">Use a headless browser service for sites where standard extraction fails. Feeds are auto-flagged when Readability consistently produces poor results.</p>

      <label class="toggle-row">
        <input type="checkbox" bind:checked={browserScrapingEnabled} on:change={autoSave} />
        <span>Enable browser scraping</span>
      </label>

      {#if browserScrapingEnabled}
        <label>
          Provider
          <select bind:value={browserScrapeProvider} on:change={autoSave}>
            <option value="cloudflare">Cloudflare (built-in)</option>
            <option value="steel">Steel.dev</option>
            <option value="browserless">Browserless</option>
            <option value="scrapingbee">ScrapingBee</option>
            <option value="generic">Generic (custom endpoint)</option>
          </select>
        </label>

        <label>
          API URL <span class="muted small">(leave blank for default)</span>
          <input type="text" bind:value={browserScrapeApiUrl} on:input={autoSave} placeholder={
            browserScrapeProvider === 'cloudflare' ? 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/browser-rendering' :
            browserScrapeProvider === 'steel' ? 'https://api.steel.dev' :
            browserScrapeProvider === 'browserless' ? 'https://chrome.browserless.io' :
            browserScrapeProvider === 'scrapingbee' ? 'https://app.scrapingbee.com/api/v1' :
            'https://your-scraper.example.com'
          } />
        </label>

        <div class="subsection soft-panel">
          <div class="key-provider-header">
            <div>
              <h3>Scraper API Key</h3>
              <p class="muted small">{browserScrapeKeyStatus ? 'Key stored' : 'No key yet'}</p>
            </div>
          </div>
          <input type="password" placeholder="Paste scraper API key" bind:value={browserScrapeApiKey} />
          <div style="display: flex; gap: 0.5rem;">
            <Button size="inline" on:click={saveBrowserScrapeKey} disabled={!browserScrapeApiKey || browserScrapeKeySaving}>
              <IconDeviceFloppy size={15} stroke={1.9} />
              <span>{browserScrapeKeySaving ? 'Saving...' : 'Save key'}</span>
            </Button>
            {#if browserScrapeKeyStatus}
              <Button variant="danger" size="inline" on:click={removeBrowserScrapeKey} disabled={browserScrapeKeySaving}>
                <IconTrash size={15} stroke={1.9} />
                <span>Remove</span>
              </Button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Generated API Keys -->
      <div class="settings-section-title">Generated API Keys</div>
      <p class="muted">Long-lived bearer tokens for CLI and terminal clients. Tokens are shown once on creation.</p>

      {#if generatedToken}
        <div class="subsection soft-panel" style="border: 1px solid var(--accent);">
          <p><strong>New API key created — copy it now!</strong></p>
          <p class="muted small">This token will not be shown again.</p>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <code style="flex: 1; overflow-x: auto; padding: 0.5rem; background: var(--surface); border-radius: var(--radius-md); font-size: var(--text-xs); word-break: break-all;">{generatedToken}</code>
            <Button size="inline" on:click={copyToken}>Copy</Button>
          </div>
          <Button variant="ghost" size="inline" on:click={() => { generatedToken = ''; }}>Dismiss</Button>
        </div>
      {/if}

      <div style="display: flex; gap: 0.5rem; align-items: flex-end;">
        <label style="flex: 1;">
          Key name
          <input type="text" placeholder="e.g. Larkline CLI" bind:value={newApiKeyName} />
        </label>
        <Button variant="primary" size="inline" on:click={generateNewApiKey} disabled={generatingApiKey}>
          <IconPlus size={15} stroke={1.9} />
          <span>{generatingApiKey ? 'Generating...' : 'Generate Key'}</span>
        </Button>
      </div>

      {#if apiKeys.length > 0}
        <div class="key-provider-grid">
          {#each apiKeys as key (key.id)}
            <div class="subsection soft-panel">
              <div class="key-provider-header">
                <div>
                  <h3>{key.name}</h3>
                  <p class="muted small">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {#if key.lastUsedAt}
                      · Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                    {:else}
                      · Never used
                    {/if}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="icon"
                  on:click={() => revokeApiKey(key.id)}
                  disabled={revokingKeyId === key.id}
                  title="Revoke key"
                >
                  <IconTrash size={15} stroke={1.9} />
                </Button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted small">No API keys generated yet.</p>
      {/if}

      <!-- User Management -->
      <div class="settings-section-title">Users</div>
      <a href="/settings/users" class="settings-link">
        Manage users, roles, and access control &rarr;
      </a>

      <!-- Connected Apps -->
      <div class="settings-section-title">Connected Apps</div>
      {#if connectedApps.length === 0}
        <p class="muted">No connected apps have authorized access yet.</p>
      {:else}
        <div class="mcp-client-list">
          {#each connectedApps as client}
            <div class="soft-panel mcp-client-card">
              <div class="split-header">
                <div>
                  <h3>{client.clientName}</h3>
                  <p class="muted small">
                    <code>{client.clientId}</code>
                  </p>
                  <p class="muted small">{appKindLabel(client.clientKind)}</p>
                </div>
                <Button
                  variant="danger"
                  size="inline"
                  on:click={() => revokeConnectedApp(client.clientId)}
                  disabled={revokingConnectedAppId === client.clientId}
                >
                  <IconTrash size={14} stroke={1.9} />
                  <span>{revokingConnectedAppId === client.clientId ? 'Revoking...' : 'Revoke access'}</span>
                </Button>
              </div>

              <div class="mcp-client-metrics">
                <span>{client.activeAccessTokens} access token{client.activeAccessTokens === 1 ? '' : 's'}</span>
                <span>{client.activeRefreshTokens} refresh token{client.activeRefreshTokens === 1 ? '' : 's'}</span>
                <span>{client.activeConsentCount} consent{client.activeConsentCount === 1 ? '' : 's'}</span>
                <span>{client.lastUsedAt ? `Last used ${new Date(client.lastUsedAt).toLocaleString()}` : 'Never used'}</span>
              </div>

              <div class="mcp-client-meta">
                <div>
                  <div class="muted small">Redirect URIs</div>
                  <ul>
                    {#each client.redirectUris as redirectUri}
                      <li><code>{redirectUri}</code></li>
                    {/each}
                  </ul>
                </div>
                <div>
                  <div class="muted small">Scope</div>
                  <p><code>{client.scope ?? 'mcp:read'}</code></p>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Scheduler -->
      <div class="settings-section-title">Scheduler</div>
      <div class="preset-grid">
        {#each schedulerPresets as preset}
          <button
            type="button"
            class="preset-btn"
            class:active={activeSchedulerPreset === preset.id}
            on:click={() => applySchedulerPreset(preset.id)}
          >
            <span class="preset-title">{preset.label}</span>
            <span class="preset-desc">{preset.description}</span>
          </button>
        {/each}
      </div>
      <p class="hint">
        Current:
        <strong>{activeSchedulerPreset === 'custom' ? `${schedulerMode} (custom)` : activeSchedulerPresetLabel}</strong>
      </p>

      <details class="advanced" bind:open={schedulerAdvancedOpen}>
        <summary>Advanced scheduler controls</summary>
        <div class="advanced-content">
          <div class="field-grid field-grid-compact">
            <label>
              Job batch size
              <input
                type="number"
                min={data.jobProcessorBatchRange.min}
                max={data.jobProcessorBatchRange.max}
                step="1"
                bind:value={jobProcessorBatchSize}
                on:input={autoSave}
              />
            </label>
            <label>
              Pull slices/tick
              <input
                type="number"
                min={data.schedulerRange.pullSlicesPerTick.min}
                max={data.schedulerRange.pullSlicesPerTick.max}
                step="1"
                bind:value={pullSlicesPerTick}
                on:input={autoSave}
              />
            </label>
            <label>
              Pull budget (ms)
              <input
                type="number"
                min={data.schedulerRange.pullSliceBudgetMs.min}
                max={data.schedulerRange.pullSliceBudgetMs.max}
                step="100"
                bind:value={pullSliceBudgetMs}
                on:input={autoSave}
              />
            </label>
          </div>

          <div class="two-col">
            <label>
              Job budget idle (ms)
              <input
                type="number"
                min={data.schedulerRange.jobBudgetIdleMs.min}
                max={data.schedulerRange.jobBudgetIdleMs.max}
                step="100"
                bind:value={jobBudgetIdleMs}
                on:input={autoSave}
              />
            </label>
            <label>
              Job budget while pull (ms)
              <input
                type="number"
                min={data.schedulerRange.jobBudgetWhilePullMs.min}
                max={data.schedulerRange.jobBudgetWhilePullMs.max}
                step="100"
                bind:value={jobBudgetWhilePullMs}
                on:input={autoSave}
              />
            </label>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" bind:checked={autoQueueTodayMissing} on:change={autoSave} />
            <span>Auto queue recent missing article jobs on ticks</span>
          </label>

          <div class="two-col">
            <label>
              Jobs interval (min)
              <input
                type="number"
                min={data.schedulerRange.jobsIntervalMinutes.min}
                max={data.schedulerRange.jobsIntervalMinutes.max}
                step="1"
                bind:value={jobsIntervalMinutes}
                on:input={autoSave}
              />
            </label>
            <label>
              Poll interval (min)
              <input
                type="number"
                min={data.schedulerRange.pollIntervalMinutes.min}
                max={data.schedulerRange.pollIntervalMinutes.max}
                step="1"
                bind:value={pollIntervalMinutes}
                on:input={autoSave}
              />
            </label>
          </div>

          <p class="hint">Estimated mode: <strong>{schedulerMode}</strong></p>

          <div class="scheduler-apply">
            <div class="scheduler-apply-row">
              <label>
                Apply target
                <select bind:value={schedulerApplyEnv}>
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                </select>
              </label>
              <Button variant="ghost" size="inline" on:click={copySchedulerCommand}>
                <span>Copy command</span>
              </Button>
            </div>
            <code class="command-code">{schedulerApplyCommand}</code>
          </div>
        </div>
      </details>

      <!-- Orphan cleanup -->
      <div class="settings-section-title">Orphan cleanup</div>
      <div class="maintenance-row">
        <div>
          <div class="maintenance-label">Orphan articles</div>
          <div class="maintenance-value">{orphanCount}</div>
          {#if orphanSampleArticleIds.length > 0}
            <p class="muted small">
              Sample IDs: {orphanSampleArticleIds.slice(0, 3).join(', ')}{orphanSampleArticleIds.length > 3 ? '...' : ''}
            </p>
          {/if}
        </div>
        <div class="maintenance-actions">
          <Button variant="ghost" size="inline" on:click={refreshOrphanPreview} disabled={orphanCleanupLoading}>
            <IconRefresh size={14} stroke={1.9} />
            <span>{orphanCleanupLoading ? 'Loading...' : 'Preview'}</span>
          </Button>
          <Button
            variant="danger"
            size="inline"
            on:click={runOrphanCleanup}
            disabled={orphanCleanupLoading || orphanCount === 0}
          >
            <IconTrash size={14} stroke={1.9} />
            <span>{orphanCleanupLoading ? 'Cleaning...' : 'Clean now'}</span>
          </Button>
        </div>
      </div>
      <p class="hint">
        Batch size: {orphanSuggestedBatchSize} per run.
        {#if orphanCleanupLastRun}
          Last run: deleted {Number(orphanCleanupLastRun?.deleted_articles ?? 0)}, remaining
          {Number(orphanCleanupLastRun?.orphan_count_after ?? 0)}, has more:
          {orphanCleanupHasMore ? 'yes' : 'no'}.
        {/if}
      </p>
    </div>
  {/if}

  <div class="settings-section-title">Account</div>
  <div class="settings-block">
    <a href="/api/auth/logout" class="action-btn" style="display: inline-block; text-align: center; text-decoration: none;">
      Sign out
    </a>
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
  /* ─── Page layout ──────────────────────────────────── */

  .settings-page {
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-5);
    display: grid;
    gap: var(--space-4);
  }

  .settings-card {
    background: var(--surface-strong);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-xl);
    padding: var(--space-5);
    display: grid;
    gap: var(--space-3);
  }

  .settings-section-title {
    font-size: var(--text-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-text);
    margin-top: var(--space-2);
  }

  .settings-section-title:first-child {
    margin-top: 0;
  }

  /* ─── Rows ─────────────────────────────────────────── */

  .settings-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    flex-wrap: wrap;
  }

  .row-label {
    min-width: 120px;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-color);
    display: inline;
  }

  .settings-row select,
  .settings-row input[type="number"] {
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    font-size: var(--text-sm);
    color: var(--text-color);
    font-family: inherit;
  }

  .settings-row input[type="number"] {
    width: 70px;
  }

  .settings-row input[type="range"] {
    flex: 1;
    min-width: 100px;
  }

  .settings-row input:not([type="number"]):not([type="radio"]):not([type="checkbox"]):not([type="range"]):not([type="password"]) {
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--input-border);
    background: var(--surface-soft);
    font-size: var(--text-sm);
    color: var(--text-color);
    font-family: inherit;
    flex: 1;
    min-width: 100px;
  }

  .unit {
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  /* ─── Toggle buttons ───────────────────────────────── */

  .settings-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    background: var(--surface-strong);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    color: var(--text-color);
    font-family: inherit;
    margin-right: var(--space-2);
  }

  .settings-toggle:hover {
    background: var(--primary-soft);
  }

  .toggle-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
  }

  .toggle-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
    margin: 0;
  }

  /* ─── Quick links ──────────────────────────────────── */

  .settings-quick-links {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-5);
  }

  .quick-link {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--surface-border);
    background: var(--surface-soft);
    color: var(--text-color);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .quick-link:hover {
    background: var(--primary-soft);
    border-color: var(--surface-border-hover);
  }

  /* ─── Hint ─────────────────────────────────────────── */

  .hint {
    font-size: var(--text-xs);
    color: var(--muted-text);
    font-weight: 400;
  }

  .muted {
    color: var(--muted-text);
    margin: 0;
  }

  .small {
    font-size: var(--text-sm);
  }

  .settings-link {
    color: var(--accent);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .settings-link:hover {
    text-decoration: underline;
  }

  /* ─── Feature lanes ────────────────────────────────── */

  .feature-lanes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3);
  }

  .feature-lane {
    display: grid;
    gap: 0.4rem;
  }

  .feature-name {
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 500;
  }

  .lane-toggle {
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    border-radius: var(--radius-md);
    padding: 0.2rem;
    background: var(--surface-soft);
    max-width: 22rem;
    width: 100%;
  }

  .lane-toggle label {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-weight: 500;
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

  /* ─── Subsections / panels ─────────────────────────── */

  .subsection {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }

  .soft-panel {
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    background: var(--surface-soft);
  }

  .subsection-header {
    display: grid;
    gap: 0.35rem;
  }

  .split-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  label {
    display: grid;
    gap: 0.4rem;
    font-size: var(--text-sm);
    font-weight: 500;
    min-width: 0;
  }

  /* ─── Inputs (for subsection contexts like keys, scheduler, prompts) ── */

  input:not([type='radio']):not([type='checkbox']):not([type='range']),
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

  /* ─── Two-col / field grids ────────────────────────── */

  .key-provider-grid,
  .two-col {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }

  .field-grid-compact {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  /* ─── QA grid ──────────────────────────────────────── */

  .qa-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3);
  }

  .qa-card {
    display: grid;
    gap: 0.35rem;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-bg);
    border: 1px solid var(--surface-border);
  }

  .qa-label {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted-text);
  }

  /* ─── Presets ──────────────────────────────────────── */

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .preset-btn {
    display: grid;
    gap: 0.35rem;
    text-align: left;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: none;
    background: var(--surface-soft);
    color: var(--text-color);
    cursor: pointer;
    font-family: inherit;
    transition:
      background var(--transition-fast),
      box-shadow var(--transition-fast);
  }

  .preset-btn:hover {
    background: var(--primary-soft);
  }

  .preset-btn.active {
    background: var(--primary-soft);
    box-shadow: inset 0 0 0 1px rgba(138, 110, 255, 0.25);
  }

  .preset-title {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .preset-desc {
    font-size: var(--text-xs);
    color: var(--muted-text);
    line-height: 1.35;
  }

  /* ─── Advanced details ─────────────────────────────── */

  .advanced {
    border-radius: var(--radius-lg);
    background: var(--surface-soft);
    padding: var(--space-3) var(--space-4);
  }

  .advanced summary {
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-color);
    list-style: none;
  }

  .advanced summary::-webkit-details-marker {
    display: none;
  }

  .advanced-content {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }

  .scheduler-apply {
    display: grid;
    gap: var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--surface);
    padding: var(--space-3);
  }

  .scheduler-apply-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .command-code {
    display: block;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 500;
  }

  .checkbox-row input[type='checkbox'] {
    width: 1rem;
    height: 1rem;
    margin: 0;
  }

  /* ─── Key provider ─────────────────────────────────── */

  .key-provider-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  /* ─── Maintenance / orphan ─────────────────────────── */

  .maintenance-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .maintenance-label {
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 600;
  }

  .maintenance-value {
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: 1.1;
    margin-top: 0.15rem;
  }

  .maintenance-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }

  /* ─── Connected apps ───────────────────────────────── */

  .mcp-client-list {
    display: grid;
    gap: var(--space-4);
  }

  .mcp-client-card {
    display: grid;
    gap: var(--space-3);
  }

  .mcp-client-metrics {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--text-sm);
    color: var(--muted-text);
  }

  .mcp-client-meta {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }

  .mcp-client-meta ul {
    margin: var(--space-2) 0 0;
    padding-left: 1rem;
  }

  .mcp-client-meta li {
    margin-bottom: 0.3rem;
    word-break: break-word;
  }

  /* ─── Signal weights table ─────────────────────────── */

  .signal-weights-table {
    display: grid;
    gap: 0;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .signal-header {
    display: grid;
    grid-template-columns: 1fr 1fr 4rem;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-text);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--surface-border);
  }

  .signal-row {
    display: grid;
    grid-template-columns: 1fr 1fr 4rem;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    align-items: center;
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--surface-border);
  }

  .signal-row:last-child {
    border-bottom: none;
  }

  .signal-name {
    text-transform: capitalize;
  }

  .signal-weight {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    position: relative;
  }

  .weight-bar {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--accent);
    min-width: 2px;
    flex-shrink: 0;
  }

  .weight-value {
    font-variant-numeric: tabular-nums;
    font-size: var(--text-xs);
    color: var(--muted-text);
    min-width: 2.5rem;
    text-align: right;
  }

  .signal-samples {
    font-variant-numeric: tabular-nums;
    text-align: right;
    font-size: var(--text-xs);
    color: var(--muted-text);
  }

  /* ─── Action button ────────────────────────────────── */

  .action-btn {
    background: var(--surface-soft);
    border: 1px solid var(--input-border);
    border-radius: var(--radius-md);
    padding: 0.5rem 1rem;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-color);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .action-btn:hover:not(:disabled) {
    background: var(--primary-soft);
    border-color: var(--primary);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  code {
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    font-size: var(--text-sm);
  }

  /* ─── Responsive ───────────────────────────────────── */

  @media (max-width: 800px) {
    .key-provider-grid,
    .two-col,
    .field-grid,
    .field-grid-compact,
    .preset-grid,
    .mcp-client-meta {
      grid-template-columns: 1fr;
    }

    .settings-row {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
