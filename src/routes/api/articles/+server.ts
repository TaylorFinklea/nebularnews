import { json } from '@sveltejs/kit';
import {
  listArticlesWithFilters,
  REACTION_VALUES,
  SCORE_VALUES,
  SORT_VALUES,
  type ReactionValue,
  type ScoreValue,
  type SortValue
} from '$lib/server/article-query';
import { resolveTagsByTokens } from '$lib/server/tags';

const DAY_MS = 1000 * 60 * 60 * 24;

const normalizeScores = (values: string[]): ScoreValue[] => {
  const requested = [...new Set(values.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  const expanded = requested.flatMap((value) => {
    if (value === 'all') return [...SCORE_VALUES];
    if (value === '4plus') return ['5', '4'] as ScoreValue[];
    if (value === '3plus') return ['5', '4', '3'] as ScoreValue[];
    if (value === 'low') return ['2', '1'] as ScoreValue[];
    if (value === 'unscored') return ['unscored'] as ScoreValue[];
    return [value];
  });
  const valid = [...new Set(expanded)].filter((value): value is ScoreValue => SCORE_VALUES.includes(value as ScoreValue));
  return valid.length > 0 ? valid : [...SCORE_VALUES];
};

const normalizeReactions = (values: string[]): ReactionValue[] => {
  const requested = [...new Set(values.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  const valid = requested.filter((value): value is ReactionValue => REACTION_VALUES.includes(value as ReactionValue));
  return valid.length > 0 ? valid : [...REACTION_VALUES];
};

const normalizeSort = (value: string | null): SortValue => {
  const normalized = (value ?? 'newest').trim().toLowerCase();
  return SORT_VALUES.includes(normalized as SortValue) ? (normalized as SortValue) : 'newest';
};

export const GET = async ({ url, platform }) => {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 20)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const query = url.searchParams.get('q')?.trim() ?? '';
  const sinceDays = (() => {
    const parsed = Number(url.searchParams.get('sinceDays') ?? '');
    if (!Number.isFinite(parsed)) return null;
    if (parsed <= 0) return null;
    return Math.min(30, Math.max(1, Math.round(parsed)));
  })();
  const minPublishedAt = sinceDays ? startedAt - sinceDays * DAY_MS : null;
  const readFilterRaw = (url.searchParams.get('read') ?? 'all').trim().toLowerCase();
  const readFilter = readFilterRaw === 'read' || readFilterRaw === 'unread' ? readFilterRaw : 'all';
  const sort = normalizeSort(url.searchParams.get('sort'));
  const selectedScores = normalizeScores(
    url.searchParams
      .getAll('score')
      .flatMap((entry) => entry.split(','))
  );
  const selectedReactions = normalizeReactions(
    url.searchParams
      .getAll('reaction')
      .flatMap((entry) => entry.split(','))
  );

  const requestedTagTokens = [
    ...new Set(
      url.searchParams
        .getAll('tags')
        .flatMap((entry) => entry.split(','))
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ];
  const selectedTags = await resolveTagsByTokens(platform.env.DB, requestedTagTokens);
  const selectedTagIds = selectedTags.map((tag) => tag.id);

  const result = await listArticlesWithFilters(platform.env.DB, {
    query,
    limit,
    offset,
    selectedScores,
    selectedReactions,
    readFilter,
    sort,
    selectedTagIds,
    minPublishedAt
  });

  return json({
    articles: result.articles,
    total: result.total,
    limit,
    offset,
    readFilter,
    sort,
    sinceDays,
    selectedScores,
    selectedReactions,
    selectedTagIds
  });
};
