import { get, writable, type Writable } from 'svelte/store';
import { invalidate } from '$app/navigation';
import { apiFetch } from '$lib/client/api-fetch';
import { readApiData, readApiErrorMessage } from '$lib/client/api-result';
import type {
  ModelOption,
  Provider,
  ProviderModelState,
  SettingsDraft,
  SettingsStateSnapshot
} from './types';

type SettingsPageData = {
  settings: {
    featureLanes?: {
      summaries?: string;
      scoring?: string;
      profileRefresh?: string;
      keyPoints?: string;
      autoTagging?: string;
      articleChat?: string;
      globalChat?: string;
    };
    ingestProvider: Provider;
    ingestModel: string;
    ingestReasoningEffort: SettingsDraft['ingestReasoningEffort'];
    chatProvider: Provider;
    chatModel: string;
    chatReasoningEffort: SettingsDraft['chatReasoningEffort'];
    scoreSystemPrompt: string;
    scoreUserPromptTemplate: string;
    summaryStyle: SettingsDraft['summaryStyle'];
    summaryLength: SettingsDraft['summaryLength'];
    initialFeedLookbackDays: number;
    retentionDays: number;
    retentionMode: SettingsDraft['retentionMode'];
    autoReadDelayMs: number;
    jobProcessorBatchSize?: number;
    articleCardLayout: SettingsDraft['articleCardLayout'];
    dashboardTopRatedLayout: SettingsDraft['dashboardTopRatedLayout'];
    dashboardTopRatedCutoff: number;
    dashboardTopRatedLimit: number;
  };
  keyMap: { openai: boolean; anthropic: boolean };
  profile: { profile_text: string; version: number; updated_at: number };
  scorePromptDefaults: {
    scoreSystemPrompt: string;
    scoreUserPromptTemplate: string;
  };
};

const initialProviderModelState = (): ProviderModelState => ({
  models: [],
  loading: false,
  error: '',
  fetchedAt: null
});

const normalizeNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createDraft = (data: SettingsPageData): SettingsDraft => ({
  laneSummaries: (data.settings.featureLanes?.summaries as SettingsDraft['laneSummaries']) ?? 'pipeline',
  laneScoring: (data.settings.featureLanes?.scoring as SettingsDraft['laneScoring']) ?? 'pipeline',
  laneProfileRefresh: (data.settings.featureLanes?.profileRefresh as SettingsDraft['laneProfileRefresh']) ?? 'pipeline',
  laneKeyPoints: (data.settings.featureLanes?.keyPoints as SettingsDraft['laneKeyPoints']) ?? 'pipeline',
  laneAutoTagging: (data.settings.featureLanes?.autoTagging as SettingsDraft['laneAutoTagging']) ?? 'pipeline',
  laneArticleChat: (data.settings.featureLanes?.articleChat as SettingsDraft['laneArticleChat']) ?? 'chat',
  laneGlobalChat: (data.settings.featureLanes?.globalChat as SettingsDraft['laneGlobalChat']) ?? 'chat',
  ingestProvider: data.settings.ingestProvider,
  ingestModel: data.settings.ingestModel,
  ingestReasoningEffort: data.settings.ingestReasoningEffort,
  chatProvider: data.settings.chatProvider,
  chatModel: data.settings.chatModel,
  chatReasoningEffort: data.settings.chatReasoningEffort,
  scoreSystemPrompt: data.settings.scoreSystemPrompt,
  scoreUserPromptTemplate: data.settings.scoreUserPromptTemplate,
  summaryStyle: data.settings.summaryStyle,
  summaryLength: data.settings.summaryLength,
  initialFeedLookbackDays: normalizeNumber(data.settings.initialFeedLookbackDays, 45),
  retentionDays: normalizeNumber(data.settings.retentionDays, 0),
  retentionMode: data.settings.retentionMode,
  autoReadDelayMs: normalizeNumber(data.settings.autoReadDelayMs, 4000),
  jobProcessorBatchSize: normalizeNumber(data.settings.jobProcessorBatchSize, 12),
  articleCardLayout: data.settings.articleCardLayout,
  dashboardTopRatedLayout: data.settings.dashboardTopRatedLayout,
  dashboardTopRatedCutoff: normalizeNumber(data.settings.dashboardTopRatedCutoff, 3),
  dashboardTopRatedLimit: normalizeNumber(data.settings.dashboardTopRatedLimit, 5),
  profileText: data.profile.profile_text
});

const serializeDraft = (draft: SettingsDraft) => JSON.stringify(draft);

const withDerived = (state: SettingsStateSnapshot): SettingsStateSnapshot => ({
  ...state,
  hasUnsavedChanges: serializeDraft(state.draft) !== serializeDraft(state.savedDraft)
});

const toSettingsPayload = (draft: SettingsDraft) => ({
  featureLanes: {
    summaries: draft.laneSummaries,
    scoring: draft.laneScoring,
    profileRefresh: draft.laneProfileRefresh,
    keyPoints: draft.laneKeyPoints,
    autoTagging: draft.laneAutoTagging,
    articleChat: draft.laneArticleChat,
    globalChat: draft.laneGlobalChat
  },
  ingestProvider: draft.ingestProvider,
  ingestModel: draft.ingestModel,
  ingestReasoningEffort: draft.ingestReasoningEffort,
  chatProvider: draft.chatProvider,
  chatModel: draft.chatModel,
  chatReasoningEffort: draft.chatReasoningEffort,
  summaryStyle: draft.summaryStyle,
  summaryLength: draft.summaryLength,
  initialFeedLookbackDays: draft.initialFeedLookbackDays,
  retentionDays: draft.retentionDays,
  retentionMode: draft.retentionMode,
  autoReadDelayMs: draft.autoReadDelayMs,
  jobProcessorBatchSize: draft.jobProcessorBatchSize,
  articleCardLayout: draft.articleCardLayout,
  dashboardTopRatedLayout: draft.dashboardTopRatedLayout,
  dashboardTopRatedCutoff: draft.dashboardTopRatedCutoff,
  dashboardTopRatedLimit: draft.dashboardTopRatedLimit,
  scoreSystemPrompt: draft.scoreSystemPrompt,
  scoreUserPromptTemplate: draft.scoreUserPromptTemplate
});

export const createSettingsState = (data: SettingsPageData) => {
  const initialDraft = createDraft(data);
  const store: Writable<SettingsStateSnapshot> = writable(
    withDerived({
      draft: { ...initialDraft },
      savedDraft: { ...initialDraft },
      keyInputs: {
        openai: '',
        anthropic: ''
      },
      keyMap: {
        openai: Boolean(data.keyMap.openai),
        anthropic: Boolean(data.keyMap.anthropic)
      },
      models: {
        openai: initialProviderModelState(),
        anthropic: initialProviderModelState()
      },
      saveMessage: '',
      saveError: '',
      isSaving: false,
      hasUnsavedChanges: false
    })
  );

  const setProviderModelState = (provider: Provider, patch: Partial<ProviderModelState>) => {
    store.update((state) => ({
      ...state,
      models: {
        ...state.models,
        [provider]: {
          ...state.models[provider],
          ...patch
        }
      }
    }));
  };

  const setDraftField = <K extends keyof SettingsDraft>(field: K, value: SettingsDraft[K]) => {
    store.update((state) =>
      withDerived({
        ...state,
        draft: {
          ...state.draft,
          [field]: value
        },
        saveMessage: '',
        saveError: ''
      })
    );
  };

  const modelStatus = (provider: Provider) => {
    const providerState = get(store).models[provider];
    if (providerState.error) return providerState.error;
    if (providerState.loading) return 'Loading models...';
    if (!providerState.models.length) return 'No models cached yet.';
    if (!providerState.fetchedAt) return `${providerState.models.length} models loaded`;
    return `${providerState.models.length} models loaded · ${new Date(providerState.fetchedAt).toLocaleTimeString()}`;
  };

  const syncModels = async (provider: Provider, options: { silent?: boolean } = {}) => {
    setProviderModelState(provider, { loading: true, error: '' });
    try {
      const res = await apiFetch(`/api/models?provider=${provider}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!options.silent) {
          setProviderModelState(provider, { error: readApiErrorMessage(payload, 'Model sync failed') });
        }
        return;
      }
      const payloadData = readApiData<{ models?: ModelOption[]; fetchedAt?: number }>(payload) ?? (payload as { models?: ModelOption[]; fetchedAt?: number });
      setProviderModelState(provider, {
        models: Array.isArray(payloadData?.models) ? payloadData.models : [],
        fetchedAt: payloadData?.fetchedAt ?? Date.now(),
        error: ''
      });
    } catch {
      if (!options.silent) {
        setProviderModelState(provider, { error: 'Model sync failed' });
      }
    } finally {
      setProviderModelState(provider, { loading: false });
    }
  };

  const bootstrapModelSync = () => {
    const snapshot = get(store);
    if (snapshot.keyMap.openai) void syncModels('openai', { silent: true });
    if (snapshot.keyMap.anthropic) void syncModels('anthropic', { silent: true });
  };

  const discardChanges = () => {
    store.update((state) =>
      withDerived({
        ...state,
        draft: { ...state.savedDraft },
        saveMessage: '',
        saveError: ''
      })
    );
  };

  const resetScorePromptDefaults = () => {
    store.update((state) =>
      withDerived({
        ...state,
        draft: {
          ...state.draft,
          scoreSystemPrompt: data.scorePromptDefaults.scoreSystemPrompt,
          scoreUserPromptTemplate: data.scorePromptDefaults.scoreUserPromptTemplate
        },
        saveMessage: '',
        saveError: ''
      })
    );
  };

  const saveAllChanges = async () => {
    const snapshot = get(store);
    if (snapshot.isSaving || !snapshot.hasUnsavedChanges) return;

    store.update((state) => ({ ...state, isSaving: true, saveMessage: '', saveError: '' }));

    try {
      const current = get(store);
      const settingsRes = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toSettingsPayload(current.draft))
      });
      if (!settingsRes.ok) {
        store.update((state) => ({
          ...state,
          saveError: 'Failed to save settings',
          isSaving: false
        }));
        return;
      }

      const nextProfile = current.draft.profileText.trim();
      if (nextProfile) {
        const profileRes = await apiFetch('/api/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ profileText: nextProfile })
        });
        if (!profileRes.ok) {
          const profilePayload = await profileRes.json().catch(() => ({}));
          store.update((state) => ({
            ...state,
            saveError: readApiErrorMessage(profilePayload, 'Failed to save profile'),
            isSaving: false
          }));
          return;
        }
      }

      store.update((state) =>
        withDerived({
          ...state,
          savedDraft: { ...state.draft },
          saveMessage: 'Settings saved.',
          saveError: '',
          isSaving: false
        })
      );

      await invalidate();
    } catch {
      store.update((state) => ({
        ...state,
        saveError: 'Failed to save settings',
        isSaving: false
      }));
    }
  };

  const setKeyInput = (provider: Provider, value: string) => {
    store.update((state) => ({
      ...state,
      keyInputs: {
        ...state.keyInputs,
        [provider]: value
      }
    }));
  };

  const saveKey = async (provider: Provider) => {
    const snapshot = get(store);
    const key = snapshot.keyInputs[provider];
    if (!key) return;
    const res = await apiFetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: key })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      store.update((state) => ({
        ...state,
        saveError: readApiErrorMessage(payload, `Failed to save ${provider} key`)
      }));
      return;
    }

    store.update((state) => ({
      ...state,
      keyInputs: {
        openai: '',
        anthropic: ''
      },
      keyMap: {
        ...state.keyMap,
        [provider]: true
      },
      saveError: ''
    }));
    await invalidate();
    await syncModels(provider);
  };

  const removeKey = async (provider: Provider) => {
    const res = await apiFetch(`/api/keys/${provider}`, { method: 'DELETE' });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      store.update((state) => ({
        ...state,
        saveError: readApiErrorMessage(payload, `Failed to remove ${provider} key`)
      }));
      return;
    }

    store.update((state) => ({
      ...state,
      keyMap: {
        ...state.keyMap,
        [provider]: false
      },
      models: {
        ...state.models,
        [provider]: initialProviderModelState()
      },
      saveError: ''
    }));
    await invalidate();
  };

  const rotateKeys = async (provider: Provider | null = null) => {
    const res = await apiFetch('/api/keys/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      store.update((state) => ({
        ...state,
        saveError: readApiErrorMessage(payload, 'Failed to rotate key ciphers')
      }));
      return;
    }

    await invalidate();
  };

  return {
    subscribe: store.subscribe,
    setDraftField,
    setKeyInput,
    syncModels,
    bootstrapModelSync,
    saveAllChanges,
    discardChanges,
    resetScorePromptDefaults,
    saveKey,
    removeKey,
    rotateKeys,
    modelStatus,
    isLoadingModels: (provider: Provider) => get(store).models[provider].loading
  };
};
