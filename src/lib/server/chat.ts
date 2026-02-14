import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from './db';
import { runChat } from './llm';
import { getFeatureProviderModel, getProviderKey } from './settings';

export type ChatScope = 'global' | 'article';

export async function createThread(db: Db, scope: ChatScope, articleId: string | null, title?: string | null) {
  const id = nanoid();
  await dbRun(
    db,
    'INSERT INTO chat_threads (id, scope, article_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, scope, articleId, title ?? null, now()]
  );
  return id;
}

export async function addChatMessage(db: Db, threadId: string, role: string, content: string, usage?: unknown) {
  await dbRun(
    db,
    'INSERT INTO chat_messages (id, thread_id, role, content, created_at, token_usage_json) VALUES (?, ?, ?, ?, ?, ?)',
    [nanoid(), threadId, role, content, now(), usage ? JSON.stringify(usage) : null]
  );
}

async function buildContext(db: Db, scope: ChatScope, articleId: string | null, query: string) {
  if (scope === 'article' && articleId) {
    const article = await dbGet<{ title: string | null; canonical_url: string | null; content_text: string | null }>(
      db,
      'SELECT title, canonical_url, content_text FROM articles WHERE id = ?',
      [articleId]
    );
    return {
      context: `Article: ${article?.title ?? 'Untitled'}\nURL: ${article?.canonical_url ?? 'Unknown'}\n\n${
        article?.content_text?.slice(0, 6000) ?? ''
      }`,
      sources: article ? [{ id: articleId, title: article.title, url: article.canonical_url }] : []
    };
  }

  const safeQuery = (query.toLowerCase().match(/\w+/g) ?? []).join(' ');
  const matches = await dbAll<{ article_id: string }>(
    db,
    'SELECT article_id FROM article_search WHERE article_search MATCH ? LIMIT 5',
    [safeQuery || query]
  );

  const sources = [] as { id: string; title: string | null; url: string | null; summary: string | null }[];
  for (const match of matches) {
    const article = await dbGet<{ id: string; title: string | null; canonical_url: string | null; content_text: string | null }>(
      db,
      'SELECT id, title, canonical_url, content_text FROM articles WHERE id = ?',
      [match.article_id]
    );
    const summary = await dbGet<{ summary_text: string }>(
      db,
      'SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
      [match.article_id]
    );
    if (article) {
      sources.push({
        id: article.id,
        title: article.title,
        url: article.canonical_url,
        summary: summary?.summary_text ?? article.content_text?.slice(0, 800) ?? null
      });
    }
  }

  const context = sources
    .map(
      (s, idx) => `Source ${idx + 1}: ${s.title ?? 'Untitled'}\nURL: ${s.url ?? 'Unknown'}\n${s.summary ?? ''}`
    )
    .join('\n\n');

  return { context, sources };
}

export async function runThreadMessage(
  db: Db,
  env: App.Platform['env'],
  threadId: string,
  userMessage: string
) {
  const thread = await dbGet<{ scope: ChatScope; article_id: string | null }>(
    db,
    'SELECT scope, article_id FROM chat_threads WHERE id = ?',
    [threadId]
  );
  if (!thread) throw new Error('Thread not found');

  const { context, sources } = await buildContext(db, thread.scope, thread.article_id, userMessage);
  const feature = thread.scope === 'article' ? 'article_chat' : 'global_chat';
  const selectedModel = await getFeatureProviderModel(db, env, feature);

  const history = await dbAll<{ role: string; content: string }>(
    db,
    'SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 6',
    [threadId]
  );
  const historyOrdered = history.reverse().map((entry) => ({ role: entry.role as 'user' | 'assistant', content: entry.content }));

  const system = `You are Nebular News. Use the provided sources to answer. Cite source titles in your answer.`;
  const apiKey = await getProviderKey(db, env, selectedModel.provider);
  if (!apiKey) {
    throw new Error(`Missing API key for ${selectedModel.provider}`);
  }
  const response = await runChat(
    selectedModel.provider,
    apiKey,
    selectedModel.model,
    [
      { role: 'system', content: `${system}\n\n${context}` },
      ...historyOrdered,
      { role: 'user', content: userMessage }
    ],
    { reasoningEffort: selectedModel.reasoningEffort }
  );
  const content = response.content;
  const usage = response.usage;

  await addChatMessage(db, threadId, 'user', userMessage);
  await addChatMessage(db, threadId, 'assistant', content, usage);

  return { content, sources };
}
