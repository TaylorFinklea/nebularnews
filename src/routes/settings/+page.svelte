<script>
  import { invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { apiFetch } from '$lib/client/api-fetch';
  import { IconDeviceFloppy, IconRefresh, IconRestore, IconTrash } from '$lib/icons';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Card from '$lib/components/Card.svelte';
  import Button from '$lib/components/Button.svelte';
  import SettingsSectionCard from '$lib/components/settings/SettingsSectionCard.svelte';
  import { showToast } from '$lib/client/toast';

  export let data;

  /** @typedef {'ai' | 'reading' | 'profile' | 'keys' | 'intake' | 'operations'} SettingsSectionId */

  const sectionConfig = [
    {
      id: 'ai',
      title: 'AI setup',
      description: 'Route features between model lanes and tune auto-tagging.',
      defaultOpen: true
    },
    {
      id: 'reading',
      title: 'Reading defaults',
      description: 'Set how summaries, cards, and queue defaults behave.',
      defaultOpen: true
    },
    {
      id: 'profile',
      title: 'Profile & prompts',
      description: 'Maintain your preference profile and fit-score instructions.',
      defaultOpen: false
    },
    {
      id: 'keys',
      title: 'Provider keys',
      description: 'Manage provider credentials and encryption rotation.',
      defaultOpen: false
    },
    {
      id: 'intake',
      title: 'Intake & retention',
      description: 'Control feed backfill, polling limits, and cleanup rules.',
      defaultOpen: false
    },
    {
      id: 'operations',
      title: 'Operations',
      description: 'Tune scheduler throughput and clean up orphaned records.',
      defaultOpen: false
    }
  ];

  const defaultSectionState = Object.fromEntries(sectionConfig.map((section) => [section.id, section.defaultOpen]));
  const sectionFields = {
    ai: [
      'laneSummaries',
      'laneScoring',
      'laneProfileRefresh',
      'laneKeyPoints',
      'laneAutoTagging',
      'laneArticleChat',
      'laneGlobalChat',
      'ingestProvider',
      'ingestModel',
      'ingestReasoningEffort',
      'chatProvider',
      'chatModel',
      'chatReasoningEffort',
      'autoTaggingEnabled',
      'autoTagMaxPerArticle'
    ],
    reading: [
      'summaryStyle',
      'summaryLength',
      'autoReadDelayMs',
      'articleCardLayout',
      'dashboardQueueWindowDays',
      'dashboardQueueLimit',
      'dashboardQueueScoreCutoff'
    ],
    profile: ['scoreSystemPrompt', 'scoreUserPromptTemplate', 'profileText'],
    keys: [],
    intake: [
      'initialFeedLookbackDays',
      'maxFeedsPerPoll',
      'maxItemsPerPoll',
      'eventsPollMs',
      'dashboardRefreshMinMs',
      'retentionDays',
      'retentionMode'
    ],
    operations: [
      'jobProcessorBatchSize',
      'jobsIntervalMinutes',
      'pollIntervalMinutes',
      'pullSlicesPerTick',
      'pullSliceBudgetMs',
      'jobBudgetIdleMs',
      'jobBudgetWhilePullMs',
      'autoQueueTodayMissing'
    ]
  };

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
  let retentionDays = Number(data.settings.retentionDays ?? data.retentionRange?.default ?? 0);
  let retentionMode = data.settings.retentionMode ?? 'archive';
  let autoReadDelayMs = Number(data.settings.autoReadDelayMs ?? 4000);
  let autoTaggingEnabled = Boolean(data.settings.autoTaggingEnabled ?? data.autoTagging?.default ?? true);
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
  let orphanCount = Number(data.orphanCleanup?.orphanCount ?? 0);
  let orphanSampleArticleIds = Array.isArray(data.orphanCleanup?.sampleArticleIds)
    ? data.orphanCleanup.sampleArticleIds
    : [];
  let orphanSuggestedBatchSize = Number(data.orphanCleanup?.suggestedBatchSize ?? 200);
  let orphanCleanupLoading = false;
  let orphanCleanupHasMore = orphanCount > 0;
  let orphanCleanupLastRun = null;
  let sectionOpen = { ...defaultSectionState };
  $: autoReadDelaySeconds = (Number(autoReadDelayMs) / 1000).toFixed(2);

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
  let hasUnsavedChanges = false;
  let modifiedSectionCount = 0;
  let dirtySections = Object.fromEntries(sectionConfig.map((section) => [section.id, false]));

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
    {
      label: 'Article Chat',
      name: 'laneArticleChat',
      get: () => laneArticleChat,
      set: (value) => {
        laneArticleChat = value;
      }
    },
    {
      label: 'Global Chat',
      name: 'laneGlobalChat',
      get: () => laneGlobalChat,
      set: (value) => {
        laneGlobalChat = value;
      }
    }
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

  const initialSnapshot = () => ({
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
    maxFeedsPerPoll: Number(maxFeedsPerPoll ?? 0),
    maxItemsPerPoll: Number(maxItemsPerPoll ?? 0),
    eventsPollMs: Number(eventsPollMs ?? 0),
    dashboardRefreshMinMs: Number(dashboardRefreshMinMs ?? 0),
    retentionDays: Number(retentionDays ?? 0),
    retentionMode,
    autoReadDelayMs: Number(autoReadDelayMs ?? 0),
    autoTaggingEnabled: Boolean(autoTaggingEnabled),
    autoTagMaxPerArticle: Number(autoTagMaxPerArticle ?? 0),
    jobProcessorBatchSize: Number(jobProcessorBatchSize ?? 0),
    jobsIntervalMinutes: Number(jobsIntervalMinutes ?? 0),
    pollIntervalMinutes: Number(pollIntervalMinutes ?? 0),
    pullSlicesPerTick: Number(pullSlicesPerTick ?? 0),
    pullSliceBudgetMs: Number(pullSliceBudgetMs ?? 0),
    jobBudgetIdleMs: Number(jobBudgetIdleMs ?? 0),
    jobBudgetWhilePullMs: Number(jobBudgetWhilePullMs ?? 0),
    autoQueueTodayMissing: Boolean(autoQueueTodayMissing),
    articleCardLayout,
    dashboardQueueWindowDays: Number(dashboardQueueWindowDays ?? 0),
    dashboardQueueLimit: Number(dashboardQueueLimit ?? 0),
    dashboardQueueScoreCutoff: Number(dashboardQueueScoreCutoff ?? 0),
    scoreSystemPrompt,
    scoreUserPromptTemplate,
    profileText
  });

  let savedSnapshot = initialSnapshot();
  let currentSnapshot = initialSnapshot();
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
    maxFeedsPerPoll: Number(maxFeedsPerPoll ?? 0),
    maxItemsPerPoll: Number(maxItemsPerPoll ?? 0),
    eventsPollMs: Number(eventsPollMs ?? 0),
    dashboardRefreshMinMs: Number(dashboardRefreshMinMs ?? 0),
    retentionDays: Number(retentionDays ?? 0),
    retentionMode,
    autoReadDelayMs: Number(autoReadDelayMs ?? 0),
    autoTaggingEnabled: Boolean(autoTaggingEnabled),
    autoTagMaxPerArticle: Number(autoTagMaxPerArticle ?? 0),
    jobProcessorBatchSize: Number(jobProcessorBatchSize ?? 0),
    jobsIntervalMinutes: Number(jobsIntervalMinutes ?? 0),
    pollIntervalMinutes: Number(pollIntervalMinutes ?? 0),
    pullSlicesPerTick: Number(pullSlicesPerTick ?? 0),
    pullSliceBudgetMs: Number(pullSliceBudgetMs ?? 0),
    jobBudgetIdleMs: Number(jobBudgetIdleMs ?? 0),
    jobBudgetWhilePullMs: Number(jobBudgetWhilePullMs ?? 0),
    autoQueueTodayMissing: Boolean(autoQueueTodayMissing),
    articleCardLayout,
    dashboardQueueWindowDays: Number(dashboardQueueWindowDays ?? 0),
    dashboardQueueLimit: Number(dashboardQueueLimit ?? 0),
    dashboardQueueScoreCutoff: Number(dashboardQueueScoreCutoff ?? 0),
    scoreSystemPrompt,
    scoreUserPromptTemplate,
    profileText
  };
  $: hasUnsavedChanges = JSON.stringify(currentSnapshot) !== JSON.stringify(savedSnapshot);
  $: dirtySections = Object.fromEntries(
    sectionConfig.map((section) => [
      section.id,
      (sectionFields[section.id] ?? []).some((field) => currentSnapshot[field] !== savedSnapshot[field])
    ])
  );
  $: modifiedSectionCount = Object.values(dirtySections).filter(Boolean).length;

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
    maxFeedsPerPoll = Number(snapshot.maxFeedsPerPoll ?? 0);
    maxItemsPerPoll = Number(snapshot.maxItemsPerPoll ?? 0);
    eventsPollMs = Number(snapshot.eventsPollMs ?? 0);
    dashboardRefreshMinMs = Number(snapshot.dashboardRefreshMinMs ?? 0);
    retentionDays = Number(snapshot.retentionDays ?? 0);
    retentionMode = snapshot.retentionMode;
    autoReadDelayMs = Number(snapshot.autoReadDelayMs ?? 0);
    autoTaggingEnabled = Boolean(snapshot.autoTaggingEnabled);
    autoTagMaxPerArticle = Number(snapshot.autoTagMaxPerArticle ?? 0);
    jobProcessorBatchSize = Number(snapshot.jobProcessorBatchSize ?? 0);
    jobsIntervalMinutes = Number(snapshot.jobsIntervalMinutes ?? 0);
    pollIntervalMinutes = Number(snapshot.pollIntervalMinutes ?? 0);
    pullSlicesPerTick = Number(snapshot.pullSlicesPerTick ?? 0);
    pullSliceBudgetMs = Number(snapshot.pullSliceBudgetMs ?? 0);
    jobBudgetIdleMs = Number(snapshot.jobBudgetIdleMs ?? 0);
    jobBudgetWhilePullMs = Number(snapshot.jobBudgetWhilePullMs ?? 0);
    autoQueueTodayMissing = Boolean(snapshot.autoQueueTodayMissing);
    articleCardLayout = snapshot.articleCardLayout;
    dashboardQueueWindowDays = Number(snapshot.dashboardQueueWindowDays ?? 0);
    dashboardQueueLimit = Number(snapshot.dashboardQueueLimit ?? 0);
    dashboardQueueScoreCutoff = Number(snapshot.dashboardQueueScoreCutoff ?? 0);
    scoreSystemPrompt = snapshot.scoreSystemPrompt;
    scoreUserPromptTemplate = snapshot.scoreUserPromptTemplate;
    profileText = snapshot.profileText;
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
  };

  const discardChanges = () => {
    if (isSavingSettings) return;
    applySnapshot(savedSnapshot);
  };

  const saveAllChanges = async () => {
    if (isSavingSettings || !hasUnsavedChanges) return;
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
          maxFeedsPerPoll,
          maxItemsPerPoll,
          eventsPollMs,
          dashboardRefreshMinMs,
          retentionDays,
          retentionMode,
          autoReadDelayMs,
          autoTaggingEnabled,
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
          scoreSystemPrompt,
          scoreUserPromptTemplate
        })
      });
      if (!settingsRes.ok) {
        showToast(await readApiError(settingsRes, 'Failed to save settings'), 'error');
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
          showToast(await readApiError(profileRes, 'Failed to save profile'), 'error');
          return;
        }
      }

      savedSnapshot = { ...currentSnapshot };
      showToast('Settings saved.', 'success');
      await invalidateAll();
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      isSavingSettings = false;
    }
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

  const sectionSummary = (sectionId) => {
    switch (sectionId) {
      case 'ai':
        return `Pipeline: ${ingestProvider}/${ingestModel} · Chat: ${chatProvider}/${chatModel} · Auto-tagging ${autoTaggingEnabled ? 'on' : 'off'}`;
      case 'reading':
        return `${summaryStyle} / ${summaryLength} · ${articleCardLayout} cards · Queue ${dashboardQueueLimit}`;
      case 'profile':
        return `Profile v${data.profile.version} · Prompt ${
          scoreSystemPrompt === data.scorePromptDefaults.scoreSystemPrompt &&
          scoreUserPromptTemplate === data.scorePromptDefaults.scoreUserPromptTemplate
            ? 'default'
            : 'custom'
        }`;
      case 'keys':
        return `OpenAI ${keyStatus.openai ? 'connected' : 'missing'} · Anthropic ${
          keyStatus.anthropic ? 'connected' : 'missing'
        }`;
      case 'intake':
        return `${initialFeedLookbackDays}-day backfill · ${maxFeedsPerPoll} feeds/${maxItemsPerPoll} items · ${retentionMode}`;
      case 'operations':
        return `${activeSchedulerPresetLabel} · ${orphanCount} orphan article${orphanCount === 1 ? '' : 's'}`;
      default:
        return '';
    }
  };

  const getSectionIdFromHash = (hashValue) => {
    const nextHash = String(hashValue ?? '').replace(/^#/, '');
    return sectionConfig.some((section) => section.id === nextHash) ? nextHash : null;
  };

  const toggleSection = (sectionId) => {
    const nextOpen = !sectionOpen[sectionId];
    sectionOpen = { ...sectionOpen, [sectionId]: nextOpen };
    if (nextOpen && typeof history !== 'undefined') {
      history.replaceState(null, '', `#${sectionId}`);
    }
  };

  const openSection = async (sectionId, { scroll = true, updateHash = true } = {}) => {
    if (!sectionConfig.some((section) => section.id === sectionId)) return;
    if (!sectionOpen[sectionId]) {
      sectionOpen = { ...sectionOpen, [sectionId]: true };
      await tick();
    }
    if (updateHash && typeof history !== 'undefined') {
      history.replaceState(null, '', `#${sectionId}`);
    }
    if (scroll) {
      document.getElementById(sectionId)?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start'
      });
    }
  };

  const openSectionFromHash = async (hashValue, { scroll = false } = {}) => {
    const sectionId = getSectionIdFromHash(hashValue);
    if (!sectionId) return;
    await openSection(sectionId, { scroll, updateHash: false });
  };

  onMount(() => {
    if (keyStatus.openai) void syncModels('openai', { silent: true });
    if (keyStatus.anthropic) void syncModels('anthropic', { silent: true });

    if (typeof window !== 'undefined') {
      void openSectionFromHash(window.location.hash, { scroll: false });

      const handleHashChange = () => {
        void openSectionFromHash(window.location.hash, { scroll: true });
      };

      window.addEventListener('hashchange', handleHashChange);
      return () => window.removeEventListener('hashchange', handleHashChange);
    }

    return undefined;
  });
</script>

<PageHeader
  title="Settings"
  description="Configure AI behavior, reading defaults, provider access, and operational controls."
/>

<div class="settings-layout">
  <div class="settings-main">
    <SettingsSectionCard
      id="ai"
      title="AI setup"
      summary={sectionSummary('ai')}
      description={sectionConfig[0].description}
      open={sectionOpen.ai}
      dirty={dirtySections.ai}
      onToggle={() => toggleSection('ai')}
    >
      <div class="section-block">
        <div class="subsection">
          <div class="subsection-header">
            <h3>Feature routing</h3>
            <p class="muted">Choose which model lane each AI feature should use.</p>
          </div>
          <div class="feature-lanes">
            {#each featureLaneOptions as feature}
              <div class="feature-lane">
                <div class="feature-name">{feature.label}</div>
                <div class="lane-toggle" role="radiogroup" aria-label={`${feature.label} lane`}>
                  <label class:active={feature.get() === 'pipeline'}>
                    <input
                      type="radio"
                      name={feature.name}
                      value="pipeline"
                      checked={feature.get() === 'pipeline'}
                      on:change={() => feature.set('pipeline')}
                    />
                    <span>Pipeline</span>
                  </label>
                  <label class:active={feature.get() === 'chat'}>
                    <input
                      type="radio"
                      name={feature.name}
                      value="chat"
                      checked={feature.get() === 'chat'}
                      on:change={() => feature.set('chat')}
                    />
                    <span>Chat</span>
                  </label>
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="subsection">
          <div class="subsection-header">
            <h3>Auto-tagging</h3>
            <p class="muted">Control whether AI tag suggestions are generated and how many can be applied.</p>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" bind:checked={autoTaggingEnabled} />
            <span>Enable AI auto-tagging</span>
          </label>
          <div class="two-col">
            <label>
              Max AI tags per article
              <input
                type="number"
                min={data.autoTagging?.maxPerArticle?.min ?? 1}
                max={data.autoTagging?.maxPerArticle?.max ?? 5}
                step="1"
                bind:value={autoTagMaxPerArticle}
              />
              <span class="hint">Applies to combined existing-tag matches plus new suggestions.</span>
            </label>
            <div class="inline-actions">
              <p class="muted small">Dismissed AI suggestions</p>
              <Button
                variant="ghost"
                size="inline"
                on:click={resetDismissedTagSuggestions}
                disabled={isResettingDismissedSuggestions}
              >
                <IconRefresh size={14} stroke={1.9} />
                <span>{isResettingDismissedSuggestions ? 'Resetting...' : 'Reset dismissed suggestions'}</span>
              </Button>
            </div>
          </div>
        </div>

        <div class="model-sections">
          <div class="subsection soft-panel">
            <div class="subsection-header">
              <h3>Pipeline lane</h3>
              <p class="muted">Faster and lower-cost lane for background jobs and bulk processing.</p>
            </div>
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
                placeholder="gpt-4o-mini"
                list={ingestProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
              />
            </label>
            <div class="model-tools">
              <Button
                variant="ghost"
                size="inline"
                on:click={() => syncModels(ingestProvider)}
                disabled={isLoadingModels(ingestProvider)}
              >
                <IconRefresh size={14} stroke={1.9} />
                <span>{isLoadingModels(ingestProvider) ? 'Loading...' : `Refresh ${ingestProvider}`}</span>
              </Button>
              <p class="muted small">{modelStatus(ingestProvider)}</p>
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
          </div>

          <div class="subsection soft-panel">
            <div class="subsection-header">
              <h3>Chat lane</h3>
              <p class="muted">Higher-capability lane for conversations and more complex tasks.</p>
            </div>
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
                placeholder="gpt-4o"
                list={chatProvider === 'anthropic' ? 'anthropic-model-options' : 'openai-model-options'}
              />
            </label>
            <div class="model-tools">
              <Button
                variant="ghost"
                size="inline"
                on:click={() => syncModels(chatProvider)}
                disabled={isLoadingModels(chatProvider)}
              >
                <IconRefresh size={14} stroke={1.9} />
                <span>{isLoadingModels(chatProvider) ? 'Loading...' : `Refresh ${chatProvider}`}</span>
              </Button>
              <p class="muted small">{modelStatus(chatProvider)}</p>
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
          </div>
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      id="reading"
      title="Reading defaults"
      summary={sectionSummary('reading')}
      description={sectionConfig[1].description}
      open={sectionOpen.reading}
      dirty={dirtySections.reading}
      onToggle={() => toggleSection('reading')}
    >
      <div class="section-block">
        <div class="two-col">
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
        </div>

        <div class="two-col">
          <label>
            Mark read after (ms)
            <input
              type="number"
              min={data.autoReadDelayRange.min}
              max={data.autoReadDelayRange.max}
              step="250"
              bind:value={autoReadDelayMs}
            />
            <span class="hint">Current: {autoReadDelaySeconds}s. 0 = immediate.</span>
          </label>

          <div class="field">
            <div class="field-label">Article card layout</div>
            <div class="lane-toggle" role="radiogroup" aria-label="Article card layout">
              <label class:active={articleCardLayout === 'split'}>
                <input type="radio" name="articleCardLayout" value="split" bind:group={articleCardLayout} />
                <span>Split</span>
              </label>
              <label class:active={articleCardLayout === 'stacked'}>
                <input type="radio" name="articleCardLayout" value="stacked" bind:group={articleCardLayout} />
                <span>Stacked</span>
              </label>
            </div>
          </div>
        </div>

        <div class="subsection soft-panel">
          <div class="subsection-header">
            <h3>Dashboard queue</h3>
            <p class="muted">Control how many high-fit stories surface in the dashboard reading queue.</p>
          </div>
          <div class="field-grid field-grid-compact">
            <label>
              Queue window (days)
              <input
                type="number"
                min={data.dashboardQueueRange.windowDays.min}
                max={data.dashboardQueueRange.windowDays.max}
                step="1"
                bind:value={dashboardQueueWindowDays}
              />
            </label>
            <label>
              Queue count
              <input
                type="number"
                min={data.dashboardQueueRange.limit.min}
                max={data.dashboardQueueRange.limit.max}
                step="1"
                bind:value={dashboardQueueLimit}
              />
            </label>
            <label>
              High-fit cutoff (1-5)
              <input
                type="number"
                min={data.dashboardQueueRange.scoreCutoff.min}
                max={data.dashboardQueueRange.scoreCutoff.max}
                step="1"
                bind:value={dashboardQueueScoreCutoff}
              />
            </label>
          </div>
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      id="profile"
      title="Profile & prompts"
      summary={sectionSummary('profile')}
      description={sectionConfig[2].description}
      open={sectionOpen.profile}
      dirty={dirtySections.profile}
      onToggle={() => toggleSection('profile')}
    >
      <div class="section-block">
        <div class="subsection">
          <div class="subsection-header">
            <h3>AI preference profile</h3>
            <p class="muted">
              Version {data.profile.version} · Updated {new Date(data.profile.updated_at).toLocaleString()}
            </p>
          </div>
          <textarea rows="8" bind:value={profileText}></textarea>
          <p class="muted small">Profile edits are saved with the global Save changes action.</p>
        </div>

        <div class="subsection">
          <div class="subsection-header split-header">
            <div>
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
            <textarea rows="4" bind:value={scoreSystemPrompt}></textarea>
          </label>
          <label>
            User prompt template
            <textarea rows="12" bind:value={scoreUserPromptTemplate}></textarea>
          </label>
          <p class="muted small">Prompt edits are saved with the global Save changes action.</p>
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      id="keys"
      title="Provider keys"
      summary={sectionSummary('keys')}
      description={sectionConfig[3].description}
      open={sectionOpen.keys}
      dirty={dirtySections.keys}
      onToggle={() => toggleSection('keys')}
    >
      <div class="section-block">
        <div class="split-header">
          <div class="subsection-header">
            <h3>Provider credentials</h3>
            <p class="muted">Stored server-side and used for model sync and runtime requests.</p>
          </div>
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
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      id="intake"
      title="Intake & retention"
      summary={sectionSummary('intake')}
      description={sectionConfig[4].description}
      open={sectionOpen.intake}
      dirty={dirtySections.intake}
      onToggle={() => toggleSection('intake')}
    >
      <div class="section-block">
        <div class="subsection">
          <div class="subsection-header">
            <h3>Feed intake</h3>
            <p class="muted">Set how much history to backfill and how many items a poll run can pull.</p>
          </div>
          <label>
            Initial feed backfill window (days)
            <input
              type="number"
              min={data.initialFeedLookbackRange.min}
              max={data.initialFeedLookbackRange.max}
              step="1"
              bind:value={initialFeedLookbackDays}
            />
            <span class="hint">Default {data.initialFeedLookbackRange.default} days. 0 = include all history.</span>
          </label>

          <div class="field-grid field-grid-compact">
            <label>
              Max feeds per poll
              <input
                type="number"
                min={data.feedPollingRange.maxFeedsPerPoll.min}
                max={data.feedPollingRange.maxFeedsPerPoll.max}
                step="1"
                bind:value={maxFeedsPerPoll}
              />
            </label>
            <label>
              Max items per poll
              <input
                type="number"
                min={data.feedPollingRange.maxItemsPerPoll.min}
                max={data.feedPollingRange.maxItemsPerPoll.max}
                step="1"
                bind:value={maxItemsPerPoll}
              />
            </label>
            <label>
              Events poll interval (ms)
              <input
                type="number"
                min={data.feedPollingRange.eventsPollMs.min}
                max={data.feedPollingRange.eventsPollMs.max}
                step="1000"
                bind:value={eventsPollMs}
              />
            </label>
          </div>

          <label>
            Dashboard refresh floor (ms)
            <input
              type="number"
              min={data.feedPollingRange.dashboardRefreshMinMs.min}
              max={data.feedPollingRange.dashboardRefreshMinMs.max}
              step="1000"
              bind:value={dashboardRefreshMinMs}
            />
          </label>
        </div>

        <div class="subsection soft-panel">
          <div class="subsection-header">
            <h3>Retention</h3>
            <p class="muted">Trim or archive older article content on the daily cleanup schedule.</p>
          </div>
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
            <span class="hint">Daily cleanup runs at 03:30 UTC. 0 days disables cleanup.</span>
          </div>
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      id="operations"
      title="Operations"
      summary={sectionSummary('operations')}
      description={sectionConfig[5].description}
      open={sectionOpen.operations}
      dirty={dirtySections.operations}
      onToggle={() => toggleSection('operations')}
    >
      <div class="section-block">
        <div class="subsection">
          <div class="subsection-header">
            <h3>Scheduler presets</h3>
            <p class="muted">Tune pull and queue throughput while keeping Worker resource use stable.</p>
          </div>

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
            Current profile:
            <strong>{activeSchedulerPreset === 'custom' ? `${schedulerMode} (custom)` : activeSchedulerPresetLabel}</strong>
          </p>

          <details class="advanced" bind:open={schedulerAdvancedOpen}>
            <summary>Advanced scheduler controls</summary>

            <div class="advanced-content">
              <div class="field-grid field-grid-compact">
                <label>
                  Job processor batch size
                  <input
                    type="number"
                    min={data.jobProcessorBatchRange.min}
                    max={data.jobProcessorBatchRange.max}
                    step="1"
                    bind:value={jobProcessorBatchSize}
                  />
                </label>
                <label>
                  Pull slices per tick
                  <input
                    type="number"
                    min={data.schedulerRange.pullSlicesPerTick.min}
                    max={data.schedulerRange.pullSlicesPerTick.max}
                    step="1"
                    bind:value={pullSlicesPerTick}
                  />
                </label>
                <label>
                  Pull slice budget (ms)
                  <input
                    type="number"
                    min={data.schedulerRange.pullSliceBudgetMs.min}
                    max={data.schedulerRange.pullSliceBudgetMs.max}
                    step="100"
                    bind:value={pullSliceBudgetMs}
                  />
                </label>
              </div>

              <div class="two-col">
                <label>
                  Job budget when idle (ms)
                  <input
                    type="number"
                    min={data.schedulerRange.jobBudgetIdleMs.min}
                    max={data.schedulerRange.jobBudgetIdleMs.max}
                    step="100"
                    bind:value={jobBudgetIdleMs}
                  />
                </label>
                <label>
                  Job budget while pull is active (ms)
                  <input
                    type="number"
                    min={data.schedulerRange.jobBudgetWhilePullMs.min}
                    max={data.schedulerRange.jobBudgetWhilePullMs.max}
                    step="100"
                    bind:value={jobBudgetWhilePullMs}
                  />
                </label>
              </div>

              <label class="checkbox-row">
                <input type="checkbox" bind:checked={autoQueueTodayMissing} />
                <span>Auto queue missing today jobs on scheduler ticks</span>
              </label>

              <div class="two-col">
                <label>
                  Jobs scheduler interval (minutes)
                  <input
                    type="number"
                    min={data.schedulerRange.jobsIntervalMinutes.min}
                    max={data.schedulerRange.jobsIntervalMinutes.max}
                    step="1"
                    bind:value={jobsIntervalMinutes}
                  />
                  <span class="hint">Applies after running the command below and deploying.</span>
                </label>
                <label>
                  Poll scheduler interval (minutes)
                  <input
                    type="number"
                    min={data.schedulerRange.pollIntervalMinutes.min}
                    max={data.schedulerRange.pollIntervalMinutes.max}
                    step="1"
                    bind:value={pollIntervalMinutes}
                  />
                  <span class="hint">Applies after running the command below and deploying.</span>
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
        </div>

        <div class="subsection soft-panel">
          <div class="subsection-header">
            <h3>Orphan cleanup</h3>
            <p class="muted">Clean up orphaned articles that no longer have any source feed linkage.</p>
          </div>

          <div class="maintenance-row">
            <div>
              <div class="maintenance-label">Orphan articles</div>
              <div class="maintenance-value">{orphanCount}</div>
              {#if orphanSampleArticleIds.length > 0}
                <p class="muted small">
                  Sample IDs: {orphanSampleArticleIds.slice(0, 3).join(', ')}{orphanSampleArticleIds.length > 3 ? '…' : ''}
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
            Batch size: {orphanSuggestedBatchSize} per run. Re-run while “has more” is true.
            {#if orphanCleanupLastRun}
              {' '}Last run: deleted {Number(orphanCleanupLastRun?.deleted_articles ?? 0)}, remaining
              {' '}{Number(orphanCleanupLastRun?.orphan_count_after ?? 0)}, has more:
              {' '}{orphanCleanupHasMore ? 'yes' : 'no'}.
            {/if}
          </p>
        </div>
      </div>
    </SettingsSectionCard>
  </div>

  <aside class="settings-rail">
    <Card variant="default" class="overview-card">
      <div class="overview-header">
        <div>
          <h2 class="overview-title">Settings overview</h2>
          <p class="muted">Use sections to jump straight to the workflow you need.</p>
        </div>
        {#if hasUnsavedChanges}
          <span class="unsaved-badge">
            {modifiedSectionCount} section{modifiedSectionCount === 1 ? '' : 's'} changed
          </span>
        {:else}
          <span class="overview-status">All changes saved</span>
        {/if}
      </div>

      <div class="save-actions">
        <Button
          variant="ghost"
          size="inline"
          on:click={discardChanges}
          disabled={!hasUnsavedChanges || isSavingSettings}
        >
          <IconRestore size={15} stroke={1.9} />
          <span>Discard</span>
        </Button>
        <Button
          variant="primary"
          size="inline"
          on:click={saveAllChanges}
          disabled={!hasUnsavedChanges || isSavingSettings}
        >
          <IconDeviceFloppy size={15} stroke={1.9} />
          <span>{isSavingSettings ? 'Saving...' : 'Save changes'}</span>
        </Button>
      </div>

      <nav class="overview-shortcuts" aria-label="Settings sections">
        {#each sectionConfig as section}
          <button
            type="button"
            class="section-shortcut"
            class:dirty={dirtySections[section.id]}
            class:open={sectionOpen[section.id]}
            aria-label={`Open ${section.title} section`}
            on:click={() => openSection(section.id)}
          >
            <span class="shortcut-copy">
              <span class="shortcut-title-row">
                <span class="shortcut-title">{section.title}</span>
                {#if dirtySections[section.id]}
                  <span class="shortcut-badge">Changed</span>
                {/if}
              </span>
              <span class="shortcut-summary">{sectionSummary(section.id)}</span>
            </span>
          </button>
        {/each}
      </nav>
    </Card>
  </aside>
</div>

{#if hasUnsavedChanges}
  <div class="mobile-save-bar">
    <div class="mobile-save-copy">
      <strong>{modifiedSectionCount} section{modifiedSectionCount === 1 ? '' : 's'} changed</strong>
      <span>Save or discard before leaving the page.</span>
    </div>
    <div class="mobile-save-actions">
      <Button
        variant="ghost"
        size="inline"
        on:click={discardChanges}
        disabled={!hasUnsavedChanges || isSavingSettings}
      >
        <span>Discard</span>
      </Button>
      <Button
        variant="primary"
        size="inline"
        on:click={saveAllChanges}
        disabled={!hasUnsavedChanges || isSavingSettings}
      >
        <span>{isSavingSettings ? 'Saving...' : 'Save changes'}</span>
      </Button>
    </div>
  </div>
{/if}

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
  .settings-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20rem;
    gap: var(--space-5);
    align-items: start;
  }

  .settings-main {
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }

  .settings-rail {
    position: sticky;
    top: var(--space-6);
    align-self: start;
  }

  :global(.overview-card) {
    display: grid;
    gap: var(--space-4);
  }

  .overview-header {
    display: grid;
    gap: var(--space-2);
  }

  .overview-title {
    margin: 0;
    font-size: var(--text-xl);
  }

  .overview-status {
    font-size: var(--text-sm);
    color: var(--muted-text);
    font-weight: 500;
  }

  .save-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .unsaved-badge {
    width: fit-content;
    border-radius: var(--radius-full);
    padding: 0.25rem 0.7rem;
    font-size: var(--text-xs);
    color: var(--primary);
    background: var(--primary-soft);
    font-weight: 600;
  }

  .overview-shortcuts {
    display: grid;
    gap: var(--space-2);
  }

  .section-shortcut {
    display: block;
    width: 100%;
    padding: var(--space-3);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-lg);
    background: var(--surface-soft);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast),
      transform var(--transition-fast);
  }

  .section-shortcut:hover {
    background: var(--primary-soft);
  }

  .section-shortcut.open {
    border-color: color-mix(in srgb, var(--primary) 30%, var(--surface-border));
  }

  .section-shortcut.dirty {
    border-color: color-mix(in srgb, var(--primary) 40%, var(--surface-border));
  }

  .shortcut-copy {
    display: grid;
    gap: 0.35rem;
  }

  .shortcut-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .shortcut-title {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .shortcut-summary {
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--muted-text);
  }

  .shortcut-badge {
    border-radius: var(--radius-full);
    padding: 0.12rem 0.45rem;
    background: var(--primary-soft);
    color: var(--primary);
    font-size: 0.7rem;
    font-weight: 600;
  }

  .section-block {
    display: grid;
    gap: var(--space-4);
  }

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

  .field {
    display: grid;
    gap: 0.4rem;
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: 500;
  }

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

  .model-sections,
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

  .model-tools,
  .inline-actions {
    display: grid;
    gap: var(--space-2);
  }

  .inline-actions {
    align-content: end;
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

  .hint {
    font-size: var(--text-xs);
    color: var(--muted-text);
    font-weight: 400;
  }

  .lane-toggle {
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    border-radius: var(--radius-full);
    padding: 0.2rem;
    background: var(--surface-soft);
    max-width: 22rem;
    width: 100%;
  }

  .lane-toggle label {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
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

  .key-provider-header,
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
    font-weight: 600;
    line-height: 1.1;
    margin-top: 0.15rem;
  }

  .maintenance-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }

  .muted {
    color: var(--muted-text);
    margin: 0;
  }

  .small {
    font-size: var(--text-sm);
  }

  .mobile-save-bar {
    display: none;
  }

  code {
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    font-size: var(--text-sm);
  }

  @media (max-width: 1100px) {
    .settings-layout {
      grid-template-columns: 1fr;
    }

    .settings-rail {
      position: static;
      order: -1;
    }
  }

  @media (max-width: 800px) {
    .model-sections,
    .key-provider-grid,
    .two-col,
    .field-grid,
    .field-grid-compact,
    .preset-grid {
      grid-template-columns: 1fr;
    }

    .mobile-save-bar {
      position: sticky;
      bottom: var(--space-4);
      display: grid;
      gap: var(--space-3);
      margin-top: var(--space-5);
      padding: var(--space-4);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-xl);
      background: color-mix(in srgb, var(--surface-strong) 92%, transparent);
      box-shadow: var(--shadow-lg);
      z-index: 10;
    }

    .mobile-save-copy {
      display: grid;
      gap: 0.2rem;
      font-size: var(--text-sm);
    }

    .mobile-save-actions {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
  }
</style>
