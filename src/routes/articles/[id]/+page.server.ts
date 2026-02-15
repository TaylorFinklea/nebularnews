import { dbAll, dbGet } from '$lib/server/db';
import { getPreferredSourceForArticle, listSourcesForArticle } from '$lib/server/sources';
import { getAutoReadDelayMs, getFeatureModelLane, getFeatureProviderModel } from '$lib/server/settings';
import { listTags, listTagsForArticle } from '$lib/server/tags';

export const load = async ({ params, platform }) => {
  const db = platform.env.DB;
  const article = await dbGet(
    db,
    `SELECT
      id,
      canonical_url,
      image_url,
      title,
      author,
      published_at,
      content_html,
      content_text,
      COALESCE((SELECT is_read FROM article_read_state WHERE article_id = articles.id LIMIT 1), 0) as is_read
    FROM articles
    WHERE id = ?`,
    [params.id]
  );

  const summary = await dbGet(
    db,
    'SELECT summary_text, provider, model, created_at, prompt_version FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );

  const keyPoints = await dbGet(
    db,
    'SELECT key_points_json, provider, model, created_at, prompt_version FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );

  const scoreOverride = await dbGet<{ score: number; comment: string | null; updated_at: number }>(
    db,
    'SELECT score, comment, updated_at FROM article_score_overrides WHERE article_id = ? LIMIT 1',
    [params.id]
  );
  const aiScore = await dbGet<{ score: number; label: string | null; reason_text: string | null; evidence_json: string | null }>(
    db,
    'SELECT score, label, reason_text, evidence_json FROM article_scores WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.id]
  );
  const score = scoreOverride
    ? {
        score: scoreOverride.score,
        label: 'User corrected',
        reason_text: scoreOverride.comment ?? 'User-set rating override',
        evidence_json: null,
        source: 'user'
      }
    : aiScore
      ? {
          ...aiScore,
          source: 'ai'
        }
      : null;

  const feedback = await dbAll(
    db,
    'SELECT rating, comment, created_at FROM article_feedback WHERE article_id = ? ORDER BY created_at DESC',
    [params.id]
  );
  const reaction = await dbGet(
    db,
    'SELECT value, feed_id, created_at FROM article_reactions WHERE article_id = ? LIMIT 1',
    [params.id]
  );

  const preferredSource = await getPreferredSourceForArticle(db, params.id);
  const sources = await listSourcesForArticle(db, params.id);
  const tags = await listTagsForArticle(db, params.id);
  const availableTags = await listTags(db, { limit: 200 });

  const articleChatLane = await getFeatureModelLane(db, 'article_chat');
  const chatModel = await getFeatureProviderModel(db, platform.env, 'article_chat');
  const modelCandidates = [
    {
      provider: chatModel.provider,
      model: chatModel.model
    }
  ];

  const keyRows = await dbAll<{ provider: string }>(db, 'SELECT provider FROM provider_keys');
  const keySet = new Set(keyRows.map((row) => row.provider));
  const providersNeeded = [chatModel.provider];
  const providersWithKeys = providersNeeded.filter((provider) => keySet.has(provider));
  const hasArticleContext = Boolean(article?.content_text && article.content_text.trim().length >= 120);
  const hasModelConfig = modelCandidates.every((candidate) => Boolean(candidate.model?.trim()));
  const hasAnyProviderKey = providersWithKeys.length > 0;

  const blockingReasons: string[] = [];
  if (!hasArticleContext) {
    blockingReasons.push('Article text is missing or too short. Pull/re-extract content first.');
  }
  if (!hasModelConfig) {
    blockingReasons.push('Chat model is not configured in Settings.');
  }
  if (!hasAnyProviderKey) {
    blockingReasons.push(`No API key available for: ${providersNeeded.join(', ')}.`);
  }

  const chatReadiness = {
    canChat: hasArticleContext && hasModelConfig && hasAnyProviderKey,
    hasArticleContext,
    hasModelConfig,
    hasAnyProviderKey,
    selectedLane: articleChatLane,
    providersNeeded,
    providersWithKeys,
    modelCandidates,
    reasons: blockingReasons
  };

  const autoReadDelayMs = await getAutoReadDelayMs(db);

  return {
    article,
    summary,
    keyPoints,
    score,
    feedback,
    reaction,
    preferredSource,
    sources,
    tags,
    availableTags,
    chatReadiness,
    autoReadDelayMs
  };
};
