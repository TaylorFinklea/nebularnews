import { apiError, apiOkWithAliases } from '$lib/server/api';
import { dbGet, dbRun } from '$lib/server/db';
import {
  attachTagToArticle,
  dismissTagSuggestion,
  ensureTagByName,
  listTagLinksForArticle,
  listTagSuggestionsForArticle,
  listTagsForArticle,
  normalizeTagSuggestionKey,
  serializeArticleTagLinkState,
  undoDismissTagSuggestion
} from '$lib/server/tags';
import { enqueueScoreJob } from '$lib/server/job-queue';
import { updateTopicAffinity } from '$lib/server/scoring/learning';

const pickSuggestion = async (
  db: D1Database,
  userId: string,
  articleId: string,
  input: { suggestionId?: string | null; name?: string | null }
) => {
  const suggestions = await listTagSuggestionsForArticle(db, userId, articleId);
  if (input.suggestionId) {
    return suggestions.find((entry) => entry.id === input.suggestionId) ?? null;
  }
  const key = normalizeTagSuggestionKey(input.name ?? '');
  if (!key) return null;
  return suggestions.find((entry) => entry.name_normalized === key) ?? null;
};

export const GET = async (event) => {
  const { params, platform, locals } = event;
  const userId = locals.user?.id ?? 'admin';
  const article = await dbGet<{ id: string }>(locals.db, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return apiError(event, 404, 'not_found', 'Article not found');

  const suggestions = await listTagSuggestionsForArticle(locals.db, userId, params.id);
  return apiOkWithAliases(
    event,
    {
      article_id: params.id,
      suggestions
    },
    { suggestions }
  );
};

export const POST = async (event) => {
  const { params, platform, request, locals } = event;
  const userId = locals.user?.id ?? 'admin';
  const article = await dbGet<{ id: string }>(locals.db, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return apiError(event, 404, 'not_found', 'Article not found');

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? '').trim().toLowerCase();
  const suggestionId = typeof body?.suggestionId === 'string' ? body.suggestionId.trim() : '';
  const suggestionName = typeof body?.name === 'string' ? body.name.trim() : '';

  if (!action) return apiError(event, 400, 'bad_request', 'Missing action');

  if (action === 'accept') {
    const beforeState = serializeArticleTagLinkState(await listTagLinksForArticle(locals.db, userId, params.id));
    const suggestion = await pickSuggestion(locals.db, userId, params.id, {
      suggestionId: suggestionId || null,
      name: suggestionName || null
    });
    if (!suggestion) return apiError(event, 404, 'not_found', 'Tag suggestion not found');

    const tag = await ensureTagByName(locals.db, suggestion.name);
    await attachTagToArticle(locals.db, userId, {
      articleId: params.id,
      tagId: tag.id,
      source: 'manual',
      confidence: suggestion.confidence
    });
    await dbRun(locals.db, 'DELETE FROM article_tag_suggestions WHERE id = ?', [suggestion.id]);
    await dbRun(
      locals.db,
      'DELETE FROM article_tag_suggestion_dismissals WHERE article_id = ? AND name_normalized = ?',
      [params.id, suggestion.name_normalized]
    );
    // Positive affinity signal for accepted tag
    updateTopicAffinity(locals.db, suggestion.name_normalized, 1).catch(() => {});
    const afterState = serializeArticleTagLinkState(await listTagLinksForArticle(locals.db, userId, params.id));
    if (beforeState !== afterState) {
      await enqueueScoreJob(locals.db, params.id);
    }
  } else if (action === 'dismiss') {
    const suggestion = await pickSuggestion(locals.db, userId, params.id, {
      suggestionId: suggestionId || null,
      name: suggestionName || null
    });
    if (!suggestion) return apiError(event, 404, 'not_found', 'Tag suggestion not found');
    await dismissTagSuggestion(locals.db, userId, params.id, suggestion.name);
    // Negative affinity signal for dismissed tag
    updateTopicAffinity(locals.db, suggestion.name_normalized, -1).catch(() => {});
  } else if (action === 'undo_dismiss') {
    const name = suggestionName;
    if (!name) return apiError(event, 400, 'bad_request', 'Missing suggestion name');
    await undoDismissTagSuggestion(locals.db, userId, {
      articleId: params.id,
      name,
      confidence: body?.confidence ?? null,
      sourceProvider: body?.sourceProvider ?? null,
      sourceModel: body?.sourceModel ?? null
    });
  } else {
    return apiError(event, 400, 'bad_request', 'Unsupported action');
  }

  const tags = await listTagsForArticle(locals.db, userId, params.id);
  const suggestions = await listTagSuggestionsForArticle(locals.db, userId, params.id);
  return apiOkWithAliases(
    event,
    {
      article_id: params.id,
      tags,
      suggestions
    },
    { tags, suggestions }
  );
};
