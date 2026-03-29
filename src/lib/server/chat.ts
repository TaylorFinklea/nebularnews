import { nanoid } from 'nanoid';
import { dbAll, dbGet, dbRun, now, type Db } from './db';
import type { Env } from './env';
import { runChat, type ChatMessage } from './llm';
import { getConfiguredModelB, getProviderKey } from './settings';

type ChatThreadRow = {
  id: string;
  article_id: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
};

type ChatMessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  token_count: number | null;
  provider: string | null;
  model: string | null;
  created_at: number;
};

const MAX_HISTORY_MESSAGES = 20;
const MAX_CONTENT_CHARS = 8000;

export async function getOrCreateThreadForArticle(
  db: Db,
  userId: string,
  articleId: string
): Promise<{ thread: ChatThreadRow | null; messages: ChatMessageRow[] }> {
  const thread = await dbGet<ChatThreadRow>(
    db,
    'SELECT * FROM chat_threads WHERE article_id = ? AND user_id = ?',
    [articleId, userId]
  );

  if (!thread) {
    return { thread: null, messages: [] };
  }

  const messages = await dbAll<ChatMessageRow>(
    db,
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [thread.id]
  );

  return { thread, messages };
}

export async function sendChatMessage(
  db: Db,
  userId: string,
  env: Env,
  articleId: string,
  userContent: string
): Promise<{ thread: ChatThreadRow; messages: ChatMessageRow[] }> {
  // Get or create thread
  let thread = await dbGet<ChatThreadRow>(
    db,
    'SELECT * FROM chat_threads WHERE article_id = ? AND user_id = ?',
    [articleId, userId]
  );

  const timestamp = now();

  if (!thread) {
    const article = await dbGet<{ title: string | null }>(
      db,
      'SELECT title FROM articles WHERE id = ?',
      [articleId]
    );
    const threadId = nanoid();
    await dbRun(
      db,
      'INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [threadId, userId, articleId, article?.title ?? null, timestamp, timestamp]
    );
    thread = { id: threadId, article_id: articleId, title: article?.title ?? null, created_at: timestamp, updated_at: timestamp };
  }

  // Fetch article context for system prompt
  const article = await dbGet<{
    title: string | null;
    content_text: string | null;
    excerpt: string | null;
  }>(db, 'SELECT title, content_text, excerpt FROM articles WHERE id = ?', [articleId]);

  const summary = await dbGet<{ summary_text: string | null }>(
    db,
    'SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [articleId]
  );

  const keyPointsRow = await dbGet<{ key_points_json: string | null }>(
    db,
    'SELECT key_points_json FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1',
    [articleId]
  );

  let keyPointsText = '';
  if (keyPointsRow?.key_points_json) {
    try {
      const points = JSON.parse(keyPointsRow.key_points_json);
      if (Array.isArray(points)) {
        keyPointsText = points.map((p: string) => `- ${p}`).join('\n');
      }
    } catch {
      // ignore parse errors
    }
  }

  const contentText = (article?.content_text ?? article?.excerpt ?? '').slice(0, MAX_CONTENT_CHARS);

  const systemPrompt = [
    'You are a helpful assistant discussing a news article with the user.',
    '',
    `Article: ${article?.title ?? 'Untitled'}`,
    summary?.summary_text ? `\nSummary: ${summary.summary_text}` : '',
    keyPointsText ? `\nKey Points:\n${keyPointsText}` : '',
    contentText ? `\nContent:\n${contentText}` : ''
  ].filter(Boolean).join('\n');

  // Get existing messages for context
  const existingMessages = await dbAll<ChatMessageRow>(
    db,
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [thread.id]
  );

  // Build LLM message array (limit history for context window)
  const recentMessages = existingMessages.slice(-MAX_HISTORY_MESSAGES);
  const llmMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    })),
    { role: 'user', content: userContent }
  ];

  // Resolve model config
  const modelConfig = await getConfiguredModelB(db, env);
  const apiKey = await getProviderKey(db, env, modelConfig.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for provider: ${modelConfig.provider}`);
  }

  // Insert user message
  const userMessageId = nanoid();
  await dbRun(
    db,
    'INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [userMessageId, thread.id, 'user', userContent, timestamp]
  );

  // Call LLM
  const result = await runChat(
    modelConfig.provider,
    apiKey,
    modelConfig.model,
    llmMessages,
    { maxTokens: 1500 }
  );

  // Insert assistant message
  const assistantMessageId = nanoid();
  const assistantTimestamp = now();
  const tokenCount = (result.usage as Record<string, number>)?.output_tokens ??
    (result.usage as Record<string, number>)?.completion_tokens ?? null;

  await dbRun(
    db,
    'INSERT INTO chat_messages (id, thread_id, role, content, token_count, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [assistantMessageId, thread.id, 'assistant', result.content, tokenCount, modelConfig.provider, modelConfig.model, assistantTimestamp]
  );

  // Update thread timestamp
  await dbRun(db, 'UPDATE chat_threads SET updated_at = ? WHERE id = ?', [assistantTimestamp, thread.id]);

  // Return all messages
  const allMessages = await dbAll<ChatMessageRow>(
    db,
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [thread.id]
  );

  return {
    thread: { ...thread, updated_at: assistantTimestamp },
    messages: allMessages
  };
}
