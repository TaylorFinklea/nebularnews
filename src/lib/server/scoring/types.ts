export type SignalName =
  | 'topic_affinity'
  | 'source_reputation'
  | 'content_freshness'
  | 'content_depth'
  | 'author_affinity'
  | 'tag_match_ratio';

export const SIGNAL_NAMES: SignalName[] = [
  'topic_affinity',
  'source_reputation',
  'content_freshness',
  'content_depth',
  'author_affinity',
  'tag_match_ratio'
];

export type SignalResult = {
  signal: SignalName;
  rawValue: number;
  normalizedValue: number; // 0.0 - 1.0
};

export type SignalWeight = {
  signalName: SignalName;
  weight: number;
  sampleCount: number;
};

export type AlgorithmicScore = {
  score: number; // 1-5
  signals: SignalResult[];
  weights: SignalWeight[];
  confidence: number; // 0.0 - 1.0 based on data availability
  weightedAverage: number; // 0.0 - 1.0 raw weighted average before mapping
};

export type ScoringMethod = 'ai' | 'algorithmic' | 'hybrid';

export const DEFAULT_SIGNAL_WEIGHTS: Record<SignalName, number> = {
  topic_affinity: 1.0,
  source_reputation: 0.8,
  content_freshness: 0.6,
  content_depth: 0.5,
  author_affinity: 0.7,
  tag_match_ratio: 0.9
};

export const LEARNING_RATE = 0.1;
export const DAMPING_FACTOR = 50;
export const DEFAULT_AI_ENHANCEMENT_THRESHOLD = 0.5;
