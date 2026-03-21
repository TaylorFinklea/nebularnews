export type Lane = 'model_a' | 'model_b';
export type Provider = 'openai' | 'anthropic';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type SummaryStyle = 'concise' | 'detailed' | 'bullet';
export type SummaryLength = 'short' | 'medium' | 'long';
export type Layout = 'split' | 'stacked';
export type RetentionMode = 'archive' | 'delete';

export type ModelOption = {
  id: string;
  label?: string;
};

export type ProviderModelState = {
  models: ModelOption[];
  loading: boolean;
  error: string;
  fetchedAt: number | null;
};

export type SettingsDraft = {
  laneSummaries: Lane;
  laneScoring: Lane;
  laneProfileRefresh: Lane;
  laneKeyPoints: Lane;
  laneAutoTagging: Lane;
  modelAProvider: Provider;
  modelAModel: string;
  modelAReasoningEffort: ReasoningEffort;
  modelBProvider: Provider;
  modelBModel: string;
  modelBReasoningEffort: ReasoningEffort;
  scoreSystemPrompt: string;
  scoreUserPromptTemplate: string;
  summaryStyle: SummaryStyle;
  summaryLength: SummaryLength;
  initialFeedLookbackDays: number;
  retentionDays: number;
  retentionMode: RetentionMode;
  autoReadDelayMs: number;
  jobProcessorBatchSize: number;
  articleCardLayout: Layout;
  dashboardQueueWindowDays: number;
  dashboardQueueLimit: number;
  dashboardQueueScoreCutoff: number;
  profileText: string;
};

export type SettingsStateSnapshot = {
  draft: SettingsDraft;
  savedDraft: SettingsDraft;
  keyInputs: {
    openai: string;
    anthropic: string;
  };
  keyMap: {
    openai: boolean;
    anthropic: boolean;
  };
  models: {
    openai: ProviderModelState;
    anthropic: ProviderModelState;
  };
  saveMessage: string;
  saveError: string;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
};
