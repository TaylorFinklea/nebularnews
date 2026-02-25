import { apiError, apiOkWithAliases } from '$lib/server/api';
import { dbGet, dbRun } from '$lib/server/db';
import {
  attachTagToArticle,
  dismissTagSuggestion,
  ensureTagByName,
  listTagSuggestionsForArticle,
  listTagsForArticle,
  normalizeTagSuggestionKey,
  undoDismissTagSuggestion
} from '$lib/server/tags';

const pickSuggestion = async (
  db: D1Database,
  articleId: string,
  input: { suggestionId?: string | null; name?: string | null }
) => {
  const suggestions = await listTagSuggestionsForArticle(db, articleId);
  if (input.suggestionId) {
    return suggestions.find((entry) => entry.id === input.suggestionId) ?? null;
  }
  const key = normalizeTagSuggestionKey(input.name ?? '');
  if (!key) return null;
  return suggestions.find((entry) => entry.name_normalized === key) ?? null;
};

export const GET = async (event) => {
  const { params, platform } = event;
  const article = await dbGet<{ id: string }>(platform.env.DB, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return apiError(event, 404, 'not_found', 'Article not found');

  const suggestions = await listTagSuggestionsForArticle(platform.env.DB, params.id);
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
  const { params, platform, request } = event;
  const article = await dbGet<{ id: string }>(platform.env.DB, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return apiError(event, 404, 'not_found', 'Article not found');

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? '').trim().toLowerCase();
  const suggestionId = typeof body?.suggestionId === 'string' ? body.suggestionId.trim() : '';
  const suggestionName = typeof body?.name === 'string' ? body.name.trim() : '';

  if (!action) return apiError(event, 400, 'bad_request', 'Missing action');

  if (action === 'accept') {
    const suggestion = await pickSuggestion(platform.env.DB, params.id, {
      suggestionId: suggestionId || null,
      name: suggestionName || null
    });
    if (!suggestion) return apiError(event, 404, 'not_found', 'Tag suggestion not found');

    const tag = await ensureTagByName(platform.env.DB, suggestion.name);
    await attachTagToArticle(platform.env.DB, {
      articleId: params.id,
      tagId: tag.id,
      source: 'manual',
      confidence: suggestion.confidence
    });
    await dbRun(platform.env.DB, 'DELETE FROM article_tag_suggestions WHERE id = ?', [suggestion.id]);
    await dbRun(
      platform.env.DB,
      'DELETE FROM article_tag_suggestion_dismissals WHERE article_id = ? AND name_normalized = ?',
      [params.id, suggestion.name_normalized]
    );
  } else if (action === 'dismiss') {
    const suggestion = await pickSuggestion(platform.env.DB, params.id, {
      suggestionId: suggestionId || null,
      name: suggestionName || null
    });
    if (!suggestion) return apiError(event, 404, 'not_found', 'Tag suggestion not found');
    await dismissTagSuggestion(platform.env.DB, params.id, suggestion.name);
  } else if (action === 'undo_dismiss') {
    const name = suggestionName;
    if (!name) return apiError(event, 400, 'bad_request', 'Missing suggestion name');
    await undoDismissTagSuggestion(platform.env.DB, {
      articleId: params.id,
      name,
      confidence: body?.confidence ?? null,
      sourceProvider: body?.sourceProvider ?? null,
      sourceModel: body?.sourceModel ?? null
    });
  } else {
    return apiError(event, 400, 'bad_request', 'Unsupported action');
  }

  const tags = await listTagsForArticle(platform.env.DB, params.id);
  const suggestions = await listTagSuggestionsForArticle(platform.env.DB, params.id);
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
