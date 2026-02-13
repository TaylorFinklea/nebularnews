import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from './db';
import { generateArticleKeyPoints, refreshPreferenceProfile, scoreArticle, summarizeArticle } from './llm';
import {
  getChatProviderModel,
  getIngestProviderModel,
  getProviderKey,
  getScorePromptConfig,
  getSummaryConfig
} from './settings';
import { ensurePreferenceProfile } from './profile';

const MAX_JOB_ATTEMPTS = 3;
type JobRunMetadata = { provider: string; model: string } | null;

export async function processJobs(env: App.Platform['env']) {
  const db = env.DB;
  const jobs = await dbAll<{
    id: string;
    type: string;
    article_id: string | null;
    attempts: number;
  }>(
    db,
    'SELECT id, type, article_id, attempts FROM jobs WHERE status = ? AND run_after <= ? ORDER BY run_after ASC LIMIT 5',
    ['pending', now()]
  );

  for (const job of jobs) {
    await dbRun(db, 'UPDATE jobs SET status = ? WHERE id = ?', ['running', job.id]);
    try {
      let runMetadata: JobRunMetadata = null;
      if (job.type === 'summarize' && job.article_id) {
        runMetadata = await runSummarizeJob(db, env, job.article_id, 'pipeline');
      } else if (job.type === 'summarize_chat' && job.article_id) {
        runMetadata = await runSummarizeJob(db, env, job.article_id, 'chat');
      } else if (job.type === 'key_points' && job.article_id) {
        runMetadata = await runKeyPointsJob(db, env, job.article_id);
      } else if (job.type === 'score' && job.article_id) {
        runMetadata = await runScoreJob(db, env, job.article_id);
      } else if (job.type === 'refresh_profile') {
        runMetadata = await runRefreshProfile(db, env);
      }

      await dbRun(db, 'UPDATE jobs SET status = ?, last_error = NULL, provider = ?, model = ? WHERE id = ?', [
        'done',
        runMetadata?.provider ?? null,
        runMetadata?.model ?? null,
        job.id
      ]);
    } catch (err) {
      const attempts = job.attempts + 1;
      const status = attempts >= MAX_JOB_ATTEMPTS ? 'failed' : 'pending';
      const runAfter = now() + 1000 * 60 * 10;
      await dbRun(
        db,
        'UPDATE jobs SET status = ?, attempts = ?, last_error = ?, run_after = ?, provider = NULL, model = NULL WHERE id = ?',
        [status, attempts, String(err), runAfter, job.id]
      );
    }
  }
}

async function runSummarizeJob(
  db: Db,
  env: App.Platform['env'],
  articleId: string,
  mode: 'pipeline' | 'chat'
): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const modelSettings =
    mode === 'chat' ? await getChatProviderModel(db, env) : await getIngestProviderModel(db, env);
  const { provider, model, reasoningEffort } = modelSettings;
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const summaryConfig = await getSummaryConfig(db);
  const contentText = article.content_text.slice(0, 12000);
  const summary = await summarizeArticle(
    provider,
    apiKey,
    model,
    {
      title: article.title,
      url: article.canonical_url,
      contentText,
      style: summaryConfig.style,
      length: summaryConfig.length
    },
    { reasoningEffort }
  );

  await dbRun(
    db,
    'INSERT INTO article_summaries (id, article_id, provider, model, summary_text, key_points_json, created_at, token_usage_json, prompt_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      nanoid(),
      articleId,
      provider,
      model,
      summary.summary,
      null,
      now(),
      JSON.stringify(summary.usage ?? {}),
      mode === 'chat' ? 'v2-chat' : 'v2-pipeline'
    ]
  );

  await dbRun(db, 'UPDATE article_search SET summary_text = ? WHERE article_id = ?', [summary.summary, articleId]);
  return { provider, model };
}

async function runKeyPointsJob(db: Db, env: App.Platform['env'], articleId: string): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const { provider, model, reasoningEffort } = await getIngestProviderModel(db, env);
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const summaryConfig = await getSummaryConfig(db);
  const contentText = article.content_text.slice(0, 12000);
  const keyPointResult = await generateArticleKeyPoints(
    provider,
    apiKey,
    model,
    {
      title: article.title,
      url: article.canonical_url,
      contentText,
      length: summaryConfig.length
    },
    { reasoningEffort }
  );

  await dbRun(
    db,
    'INSERT INTO article_key_points (id, article_id, provider, model, key_points_json, created_at, token_usage_json, prompt_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      nanoid(),
      articleId,
      provider,
      model,
      JSON.stringify(keyPointResult.keyPoints),
      now(),
      JSON.stringify(keyPointResult.usage ?? {}),
      'v1-pipeline'
    ]
  );

  return { provider, model };
}


async function runScoreJob(db: Db, env: App.Platform['env'], articleId: string): Promise<{ provider: string; model: string }> {
  const article = await dbGet<{
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
  }>(db, 'SELECT title, canonical_url, content_text FROM articles WHERE id = ?', [articleId]);
  if (!article?.content_text) throw new Error('Missing article content');

  const profile = await ensurePreferenceProfile(db);
  const { provider, model, reasoningEffort } = await getIngestProviderModel(db, env);
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const contentText = article.content_text.slice(0, 12000);
  const scorePromptConfig = await getScorePromptConfig(db);
  const scored = await scoreArticle(provider, apiKey, model, {
    title: article.title,
    url: article.canonical_url,
    contentText,
    profile: profile.profile_text
  }, { reasoningEffort }, scorePromptConfig);

  await dbRun(
    db,
    'INSERT INTO article_scores (id, article_id, score, label, reason_text, evidence_json, created_at, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      nanoid(),
      articleId,
      scored.score,
      scored.label,
      scored.reason,
      JSON.stringify(scored.evidence),
      now(),
      profile.version
    ]
  );
  return { provider, model };
}

async function runRefreshProfile(db: Db, env: App.Platform['env']): Promise<{ provider: string; model: string } | null> {
  const profile = await ensurePreferenceProfile(db);
  const feedback = await dbAll<{ rating: number; comment: string | null; title: string | null }>(
    db,
    `SELECT article_feedback.rating as rating, article_feedback.comment as comment, articles.title as title
     FROM article_feedback
     LEFT JOIN articles ON article_feedback.article_id = articles.id
     ORDER BY article_feedback.created_at DESC
     LIMIT 30`
  );

  if (feedback.length === 0) return null;

  const { provider, model, reasoningEffort } = await getIngestProviderModel(db, env);
  const apiKey = await getProviderKey(db, env, provider);
  if (!apiKey) throw new Error('No provider key');

  const updated = await refreshPreferenceProfile(provider, apiKey, model, {
    current: profile.profile_text,
    feedback
  }, { reasoningEffort });

  await dbRun(
    db,
    'UPDATE preference_profile SET profile_text = ?, updated_at = ?, version = version + 1 WHERE id = ?',
    [updated, now(), profile.id]
  );
  return { provider, model };
}
