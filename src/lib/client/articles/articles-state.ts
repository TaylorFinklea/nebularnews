import { get, writable, type Writable } from 'svelte/store';
import { apiFetch } from '$lib/client/api-fetch';
import { runOptimisticMutation } from '$lib/client/mutations';
import type { ArticleListItem, ArticlesFilters, ArticlesUiState } from './types';

const TOAST_TIMEOUT_MS = 4000;

const toInt = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const normalizeReadValue = (value: unknown) => (toInt(value, 0) === 1 ? 1 : 0);

export const reactionNumber = (value: unknown) => {
  const numeric = Number(value);
  if (numeric === 1) return 1;
  if (numeric === -1) return -1;
  return null;
};

export const normalizeArticle = (article: ArticleListItem): ArticleListItem => ({
  ...article,
  is_read: normalizeReadValue(article?.is_read),
  reaction_value: reactionNumber(article?.reaction_value),
  tags: Array.isArray(article?.tags) ? article.tags : []
});

export const isArticleRead = (article: ArticleListItem) => normalizeReadValue(article?.is_read) === 1;

export const scoreLabel = (score: unknown) => {
  const normalized = Number(score ?? 0);
  if (!normalized) return 'Unscored';
  if (normalized >= 5) return 'Perfect fit';
  if (normalized >= 4) return 'Strong fit';
  if (normalized >= 3) return 'Okay fit';
  if (normalized >= 2) return 'Weak fit';
  return 'Not a fit';
};

const scoreToken = (score: unknown) => {
  const numeric = toInt(score, Number.NaN);
  if (Number.isNaN(numeric) || numeric < 1 || numeric > 5) return 'unscored';
  return String(numeric);
};

const reactionFilterValue = (reactionValue: unknown) => {
  const normalized = reactionNumber(reactionValue);
  if (normalized === 1) return 'up';
  if (normalized === -1) return 'down';
  return 'none';
};

const articleHasSelectedTags = (article: ArticleListItem, selectedTagIds: string[]) => {
  if (selectedTagIds.length === 0) return true;
  const tagIds = new Set((article.tags ?? []).map((tag) => String(tag?.id ?? tag)));
  return selectedTagIds.every((tagId) => tagIds.has(String(tagId)));
};

const matchesClientFilters = (article: ArticleListItem, filters: ArticlesFilters) => {
  if (!filters.selectedScores.includes(scoreToken(article.score))) return false;
  if (filters.readFilter === 'read' && !isArticleRead(article)) return false;
  if (filters.readFilter === 'unread' && isArticleRead(article)) return false;
  if (filters.selectedReactions.length === 0) return false;
  if (!filters.selectedReactions.includes(reactionFilterValue(article.reaction_value))) return false;
  if (!articleHasSelectedTags(article, filters.selectedTagIds)) return false;
  return true;
};

const createInitialState = (articles: ArticleListItem[]): ArticlesUiState => ({
  serverArticles: articles.map((article) => normalizeArticle(article)),
  optimisticById: {},
  pendingById: {},
  imageErrors: {},
  uiMessage: ''
});

const getMergedArticles = (snapshot: ArticlesUiState) =>
  snapshot.serverArticles.map((article) => ({
    ...article,
    ...(snapshot.optimisticById[article.id] ?? {})
  }));

export const getVisibleArticles = (snapshot: ArticlesUiState, filters: ArticlesFilters) =>
  getMergedArticles(snapshot).filter((article) => matchesClientFilters(article, filters));

export const createArticlesState = (initialArticles: ArticleListItem[]) => {
  const store: Writable<ArticlesUiState> = writable(createInitialState(initialArticles));
  let messageTimer: ReturnType<typeof setTimeout> | null = null;
  let lastServerSignature = JSON.stringify(initialArticles.map((article) => normalizeArticle(article)));

  const setUiMessage = (message: string) => {
    if (messageTimer) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }
    store.update((state) => ({ ...state, uiMessage: message }));
    messageTimer = setTimeout(() => {
      store.update((state) => ({ ...state, uiMessage: '' }));
      messageTimer = null;
    }, TOAST_TIMEOUT_MS);
  };

  const setPending = (articleId: string, isPending: boolean) => {
    store.update((state) => {
      if (isPending) {
        return {
          ...state,
          pendingById: { ...state.pendingById, [articleId]: true }
        };
      }
      if (!state.pendingById[articleId]) return state;
      const next = { ...state.pendingById };
      delete next[articleId];
      return { ...state, pendingById: next };
    });
  };

  const setOptimisticPatch = (articleId: string, patch: Partial<ArticleListItem>) => {
    store.update((state) => {
      const current = state.optimisticById[articleId] ?? {};
      return {
        ...state,
        optimisticById: {
          ...state.optimisticById,
          [articleId]: {
            ...current,
            ...patch
          }
        }
      };
    });
  };

  const clearOptimisticFields = (articleId: string, fields: Array<keyof ArticleListItem>) => {
    store.update((state) => {
      const current = state.optimisticById[articleId];
      if (!current) return state;
      const next = { ...current };
      for (const field of fields) {
        delete next[field];
      }
      if (Object.keys(next).length === 0) {
        const nextOptimistic = { ...state.optimisticById };
        delete nextOptimistic[articleId];
        return {
          ...state,
          optimisticById: nextOptimistic
        };
      }
      return {
        ...state,
        optimisticById: {
          ...state.optimisticById,
          [articleId]: next
        }
      };
    });
  };

  const updateServerArticle = (articleId: string, patch: Partial<ArticleListItem>) => {
    store.update((state) => ({
      ...state,
      serverArticles: state.serverArticles.map((article) =>
        article.id === articleId
          ? normalizeArticle({
              ...article,
              ...patch
            })
          : article
      )
    }));
  };

  const findMergedArticle = (articleId: string) =>
    getMergedArticles(get(store)).find((article) => article.id === articleId) ?? null;

  const isPending = (articleId: string) => Boolean(get(store).pendingById[articleId]);

  const syncFromServer = (articles: ArticleListItem[]) => {
    const normalized = articles.map((article) => normalizeArticle(article));
    const signature = JSON.stringify(normalized);
    if (signature === lastServerSignature) return;
    lastServerSignature = signature;
    store.update((state) => ({
      ...state,
      serverArticles: normalized
    }));
  };

  const markImageError = (articleId: string) => {
    store.update((state) => ({
      ...state,
      imageErrors: { ...state.imageErrors, [articleId]: true }
    }));
  };

  const isImageFailed = (articleId: string) => Boolean(get(store).imageErrors[articleId]);

  const reactToArticle = async (
    articleId: string,
    value: 1 | -1,
    feedId: string | null | undefined,
    options?: { optimisticEnabled?: boolean }
  ) => {
    if (isPending(articleId)) return;
    const currentArticle = findMergedArticle(articleId);
    if (!currentArticle) return;

    const optimisticEnabled = options?.optimisticEnabled !== false;
    const previous = reactionNumber(currentArticle.reaction_value);
    setPending(articleId, true);

    if (!optimisticEnabled) {
      try {
        const res = await apiFetch(`/api/articles/${articleId}/reaction`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value, feedId })
        });
        if (!res.ok) throw new Error('reaction_failed');
        updateServerArticle(articleId, { reaction_value: value });
      } catch {
        setOptimisticPatch(articleId, { reaction_value: previous });
        clearOptimisticFields(articleId, ['reaction_value']);
        setUiMessage('Unable to save feed reaction. Reverted to previous state.');
      } finally {
        setPending(articleId, false);
      }
      return;
    }

    const mutation = await runOptimisticMutation({
      key: `article:${articleId}:reaction`,
      fallbackErrorMessage: 'Unable to save feed reaction',
      applyOptimistic: () => setOptimisticPatch(articleId, { reaction_value: value }),
      revertOptimistic: () => {
        setOptimisticPatch(articleId, { reaction_value: previous });
        clearOptimisticFields(articleId, ['reaction_value']);
      },
      request: () =>
        apiFetch(`/api/articles/${articleId}/reaction`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value, feedId })
        })
    });

    if (mutation.ok) {
      const reactionValue = Number((mutation.data as { reaction?: { value?: number } } | undefined)?.reaction?.value ?? value);
      updateServerArticle(articleId, { reaction_value: reactionValue });
      clearOptimisticFields(articleId, ['reaction_value']);
    } else if (!mutation.skipped) {
      setUiMessage(`${mutation.error?.message ?? 'Unable to save feed reaction'}. Reverted to previous state.`);
    }

    setPending(articleId, false);
  };

  const setReadState = async (articleId: string, isRead: boolean, options?: { optimisticEnabled?: boolean }) => {
    if (isPending(articleId)) return;
    const currentArticle = findMergedArticle(articleId);
    if (!currentArticle) return;

    const optimisticEnabled = options?.optimisticEnabled !== false;
    const previous = normalizeReadValue(currentArticle.is_read);
    setPending(articleId, true);

    if (!optimisticEnabled) {
      try {
        const res = await apiFetch(`/api/articles/${articleId}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isRead })
        });
        if (!res.ok) throw new Error('read_state_failed');
        updateServerArticle(articleId, { is_read: isRead ? 1 : 0 });
      } catch {
        setOptimisticPatch(articleId, { is_read: previous });
        clearOptimisticFields(articleId, ['is_read']);
        setUiMessage('Unable to save read state. Reverted to previous state.');
      } finally {
        setPending(articleId, false);
      }
      return;
    }

    const mutation = await runOptimisticMutation({
      key: `article:${articleId}:read`,
      fallbackErrorMessage: 'Unable to save read state',
      applyOptimistic: () => setOptimisticPatch(articleId, { is_read: isRead ? 1 : 0 }),
      revertOptimistic: () => {
        setOptimisticPatch(articleId, { is_read: previous });
        clearOptimisticFields(articleId, ['is_read']);
      },
      request: () =>
        apiFetch(`/api/articles/${articleId}/read`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isRead })
        })
    });

    if (mutation.ok) {
      const payload = mutation.data as { is_read?: number } | undefined;
      const serverValue = normalizeReadValue(payload?.is_read ?? (isRead ? 1 : 0));
      updateServerArticle(articleId, { is_read: serverValue });
      clearOptimisticFields(articleId, ['is_read']);
    } else if (!mutation.skipped) {
      setUiMessage(`${mutation.error?.message ?? 'Unable to save read state'}. Reverted to previous state.`);
    }

    setPending(articleId, false);
  };

  const destroy = () => {
    if (messageTimer) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }
  };

  return {
    subscribe: store.subscribe,
    syncFromServer,
    getMergedArticles: () => getMergedArticles(get(store)),
    getVisibleArticles: (filters: ArticlesFilters) => getVisibleArticles(get(store), filters),
    markImageError,
    isImageFailed,
    isPending,
    reactToArticle,
    setReadState,
    destroy
  };
};
