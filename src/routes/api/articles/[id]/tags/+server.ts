import { json } from '@sveltejs/kit';
import { dbGet } from '$lib/server/db';
import {
  attachTagToArticle,
  ensureTagByName,
  detachTagFromArticle,
  listTagsForArticle,
  resolveTagsByTokens,
  type TagSource
} from '$lib/server/tags';

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

export const GET = async ({ params, platform }) => {
  const article = await dbGet<{ id: string }>(platform.env.DB, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return json({ error: 'Article not found' }, { status: 404 });
  const tags = await listTagsForArticle(platform.env.DB, params.id);
  return json({ tags });
};

export const POST = async ({ params, request, platform }) => {
  const article = await dbGet<{ id: string }>(platform.env.DB, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return json({ error: 'Article not found' }, { status: 404 });

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
  return json({
    ok: true,
    tags,
    counts: {
      added: addIds.size,
      removed: removeIds.size
    }
  });
};
