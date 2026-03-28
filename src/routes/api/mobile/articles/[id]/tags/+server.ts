import { json } from '@sveltejs/kit';
import { dbGet } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import {
  attachTagToArticle,
  detachTagFromArticle,
  ensureTagByName,
  listTagLinksForArticle,
  listTagsForArticle,
  resolveTagsByTokens,
  serializeArticleTagLinkState,
  type TagSource
} from '$lib/server/tags';
import { enqueueScoreJob } from '$lib/server/job-queue';

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

export const GET = async ({ params, request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:read');
  const article = await dbGet<{ id: string }>(locals.db, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return json({ error: 'Article not found' }, { status: 404 });
  const tags = await listTagsForArticle(locals.db, user.id, params.id);
  return json({ tags });
};

export const POST = async ({ params, request, platform, locals }) => {
  const { user } = await requireMobileAccess(request, platform.env, locals.db, 'app:write');

  const article = await dbGet<{ id: string }>(locals.db, 'SELECT id FROM articles WHERE id = ? LIMIT 1', [params.id]);
  if (!article) return json({ error: 'Article not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const source = normalizeSource(body?.source);
  const confidence = normalizeConfidence(body?.confidence);
  const addTagIds = normalizeTokenList(body?.addTagIds ?? body?.add_tag_ids);
  const addTagNames = normalizeTokenList(body?.addTagNames ?? body?.add_tag_names);
  const removeTagIds = normalizeTokenList(body?.removeTagIds ?? body?.remove_tag_ids);
  const replace = (body?.replace === true);

  const addByIdRows = await resolveTagsByTokens(locals.db, addTagIds);
  const addIds = new Set(addByIdRows.map((row) => row.id));

  for (const name of addTagNames) {
    const tag = await ensureTagByName(locals.db, name);
    addIds.add(tag.id);
  }

  const removeRows = await resolveTagsByTokens(locals.db, removeTagIds);
  const removeIds = new Set(removeRows.map((row) => row.id));
  const beforeState = serializeArticleTagLinkState(await listTagLinksForArticle(locals.db, user.id, params.id));

  if (replace) {
    const current = await listTagsForArticle(locals.db, user.id, params.id);
    for (const tag of current) {
      if (!addIds.has(tag.id)) {
        await detachTagFromArticle(locals.db, user.id, params.id, tag.id);
      }
    }
  }

  for (const tagId of addIds) {
    await attachTagToArticle(locals.db, user.id, {
      articleId: params.id,
      tagId,
      source,
      confidence
    });
  }

  for (const tagId of removeIds) {
    await detachTagFromArticle(locals.db, user.id, params.id, tagId);
  }

  const afterState = serializeArticleTagLinkState(await listTagLinksForArticle(locals.db, user.id, params.id));
  if (beforeState !== afterState) {
    await enqueueScoreJob(locals.db, params.id);
  }

  const tags = await listTagsForArticle(locals.db, user.id, params.id);
  return json({
    article_id: params.id,
    tags,
    counts: {
      added: addIds.size,
      removed: removeIds.size
    }
  });
};
