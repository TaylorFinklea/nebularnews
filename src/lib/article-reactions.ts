export type ReactionValue = 1 | -1;

export const UP_REACTION_REASON_OPTIONS = [
  { code: 'up_interest_match', label: 'Matches my interests' },
  { code: 'up_source_trust', label: 'Trust this source' },
  { code: 'up_good_timing', label: 'Good timing' },
  { code: 'up_good_depth', label: 'Good depth' },
  { code: 'up_author_like', label: 'Like this author' }
] as const;

export const DOWN_REACTION_REASON_OPTIONS = [
  { code: 'down_off_topic', label: 'Off topic for me' },
  { code: 'down_source_distrust', label: "Don't trust this source" },
  { code: 'down_stale', label: 'Too old / stale' },
  { code: 'down_too_shallow', label: 'Too shallow' },
  { code: 'down_avoid_author', label: 'Avoid this author' }
] as const;

export type UpReactionReasonCode = (typeof UP_REACTION_REASON_OPTIONS)[number]['code'];
export type DownReactionReasonCode = (typeof DOWN_REACTION_REASON_OPTIONS)[number]['code'];
export type ArticleReactionReasonCode = UpReactionReasonCode | DownReactionReasonCode;

export type ReactionReasonOption = {
  code: ArticleReactionReasonCode;
  label: string;
};

export const ALL_REACTION_REASON_OPTIONS = [
  ...UP_REACTION_REASON_OPTIONS,
  ...DOWN_REACTION_REASON_OPTIONS
] as const;

export const ALL_REACTION_REASON_CODES = ALL_REACTION_REASON_OPTIONS.map((option) => option.code);

// Future-facing reason-to-signal mapping. This is stored for later learning work, but not applied in v1.
export const REACTION_REASON_SIGNAL_MAP = {
  up_interest_match: 'topic_affinity',
  down_off_topic: 'topic_affinity',
  up_source_trust: 'source_reputation',
  down_source_distrust: 'source_reputation',
  up_good_timing: 'content_freshness',
  down_stale: 'content_freshness',
  up_good_depth: 'content_depth',
  down_too_shallow: 'content_depth',
  up_author_like: 'author_affinity',
  down_avoid_author: 'author_affinity'
} as const;

const ALL_REASON_CODE_SET = new Set<string>(ALL_REACTION_REASON_CODES);
const REASON_LABEL_BY_CODE = new Map<string, string>(
  ALL_REACTION_REASON_OPTIONS.map((option) => [option.code, option.label])
);

export const isReactionValue = (value: unknown): value is ReactionValue => value === 1 || value === -1;

export const isValidReactionReasonCode = (value: unknown): value is ArticleReactionReasonCode =>
  typeof value === 'string' && ALL_REASON_CODE_SET.has(value);

export const getReasonOptionsForReaction = (value: ReactionValue) =>
  (value === 1 ? UP_REACTION_REASON_OPTIONS : DOWN_REACTION_REASON_OPTIONS) as readonly ReactionReasonOption[];

export const getReactionReasonLabel = (code: ArticleReactionReasonCode) =>
  REASON_LABEL_BY_CODE.get(code) ?? code;

export const canonicalizeReasonCodesForReaction = (
  value: ReactionValue,
  reasonCodes: readonly ArticleReactionReasonCode[]
) => {
  const selected = new Set(reasonCodes);
  return getReasonOptionsForReaction(value)
    .map((option) => option.code)
    .filter((code) => selected.has(code));
};

export const areReasonCodesValidForReaction = (
  value: ReactionValue,
  reasonCodes: readonly ArticleReactionReasonCode[]
) => {
  const allowed = new Set(getReasonOptionsForReaction(value).map((option) => option.code));
  return reasonCodes.every((code) => allowed.has(code));
};
