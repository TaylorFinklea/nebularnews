import { dbGet } from '$lib/server/db';
import {
  attachTagToArticle,
  ensureTagByName,
  detachTagFromArticle,
  listTagsForArticle,
  resolveTagsByTokens,
  type TagSource
} from '$lib/server/tags';
import { apiError, apiOkWithAliases } from '$lib/server/api';
import { logInfo } from '$lib/server/log';

const normalizeSource = (value: unknown): TagSource => {
  if (value === 'ai' || value === 'system' || value === 'manual') return value;
  return 'manual';
};

const normalizeConfidence = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
};

const normalizeTokenList = (value: unknown) =>
  Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];

export const GET = async (event) => {
  const { params, platform } = event;
  const article = await dbGet<{ id: string }>(platform.env.DB, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return apiError(event, 404, 'not_found', 'Article not found');
  const tags = await listTagsForArticle(platform.env.DB, params.id);
  return apiOkWithAliases(
    event,
    {
      tags
    },
    { tags }
  );
};

export const POST = async (event) => {
  const { params, request, platform } = event;
  const article = await dbGet<{ id: string }>(platform.env.DB, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return apiError(event, 404, 'not_found', 'Article not found');

  const body = await request.json().catch(() => ({}));
  const source = normalizeSource(body?.source);
  const confidence = normalizeConfidence(body?.confidence);
  const addTagIds = normalizeTokenList(body?.addTagIds);
  const addTagNames = normalizeTokenList(body?.addTagNames);
  const removeTagIds = normalizeTokenList(body?.removeTagIds);
  const replace = body?.replace === true;

  const addByIdRows = await resolveTagsByTokens(platform.env.DB, addTagIds);
  const addIds = new Set(addByIdRows.map((row) => row.id));

  for (const name of addTagNames) {
    const tag = await ensureTagByName(platform.env.DB, name);
    addIds.add(tag.id);
  }

  const removeRows = await resolveTagsByTokens(platform.env.DB, removeTagIds);
  const removeIds = new Set(removeRows.map((row) => row.id));

  if (replace) {
    const current = await listTagsForArticle(platform.env.DB, params.id);
    const keepIds = addIds;
    for (const tag of current) {
      if (!keepIds.has(tag.id)) {
        await detachTagFromArticle(platform.env.DB, params.id, tag.id);
      }
    }
  }

  for (const tagId of addIds) {
    await attachTagToArticle(platform.env.DB, {
      articleId: params.id,
      tagId,
      source,
      confidence
    });
  }

  for (const tagId of removeIds) {
    await detachTagFromArticle(platform.env.DB, params.id, tagId);
  }

  const tags = await listTagsForArticle(platform.env.DB, params.id);
  const counts = {
      added: addIds.size,
      removed: removeIds.size
    };

  logInfo('article.tags.updated', {
    request_id: event.locals.requestId,
    article_id: params.id,
    added: counts.added,
    removed: counts.removed
  });

  return apiOkWithAliases(
    event,
    {
      article_id: params.id,
      tags,
      counts
    },
    {
      tags,
      counts
    }
  );
};
