import {
  listArticlesWithFilters,
  REACTION_VALUES,
  SCORE_VALUES,
  SORT_VALUES,
  type ReactionValue,
  type ScoreValue,
  type SortValue
} from '$lib/server/article-query';
import { getArticleCardLayout } from '$lib/server/settings';
import { listTags, resolveTagsByTokens } from '$lib/server/tags';
import { isOptimisticMutationsEnabled } from '$lib/server/flags';

const PAGE_SIZE = 40;
const DAY_MS = 1000 * 60 * 60 * 24;
const VIEW_VALUES = ['list', 'grouped'] as const;
type ViewValue = (typeof VIEW_VALUES)[number];
const LAYOUT_VALUES = ['split', 'stacked'] as const;
type LayoutValue = (typeof LAYOUT_VALUES)[number];

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

export const load = async ({ platform, url, setHeaders }) => {
  const startedAt = Date.now();
  const defaultCardLayout = await getArticleCardLayout(platform.env.DB);
  const query = url.searchParams.get('q')?.trim() ?? '';
  const sinceDays = (() => {
    const parsed = Number(url.searchParams.get('sinceDays') ?? '');
    if (!Number.isFinite(parsed)) return null;
    if (parsed <= 0) return null;
    return Math.min(30, Math.max(1, Math.round(parsed)));
  })();
  const minPublishedAt = sinceDays ? startedAt - sinceDays * DAY_MS : null;
  const requestedPage = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const view = (() => {
    const value = (url.searchParams.get('view') ?? 'list').trim().toLowerCase();
    return VIEW_VALUES.includes(value as ViewValue) ? (value as ViewValue) : 'list';
  })();
  const layout = (() => {
    const value = (url.searchParams.get('layout') ?? defaultCardLayout).trim().toLowerCase();
    return LAYOUT_VALUES.includes(value as LayoutValue) ? (value as LayoutValue) : defaultCardLayout;
  })();
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
  const readFilterRaw = (url.searchParams.get('read') ?? 'all').trim().toLowerCase();
  const readFilter = readFilterRaw === 'read' || readFilterRaw === 'unread' ? readFilterRaw : 'all';
  const sort = normalizeSort(url.searchParams.get('sort'));

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

  const initialOffset = (requestedPage - 1) * PAGE_SIZE;
  const firstPass = await listArticlesWithFilters(platform.env.DB, {
    query,
    limit: PAGE_SIZE,
    offset: initialOffset,
    selectedScores,
    selectedReactions,
    readFilter,
    sort,
    selectedTagIds,
    minPublishedAt,
    groupedByPublishedAt: view === 'grouped'
  });
  const total = firstPass.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;
  const result =
    offset === initialOffset
      ? firstPass
      : await listArticlesWithFilters(platform.env.DB, {
          query,
          limit: PAGE_SIZE,
          offset,
          selectedScores,
          selectedReactions,
          readFilter,
          sort,
          selectedTagIds,
          minPublishedAt,
          groupedByPublishedAt: view === 'grouped'
        });

  const availableTags = await listTags(platform.env.DB, { limit: 150 });

  const payload = {
    articles: result.articles,
    q: query,
    selectedScores,
    sinceDays,
    readFilter,
    sort,
    view,
    layout,
    selectedReactions,
    optimisticMutationsEnabled: isOptimisticMutationsEnabled(platform.env),
    availableTags,
    selectedTagIds,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      start: total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
      end: Math.min(page * PAGE_SIZE, total)
    }
  };

  setHeaders({
    'server-timing': `articles_list;dur=${Date.now() - startedAt}`
  });

  return payload;
};
