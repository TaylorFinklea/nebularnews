import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, runChatStreaming, type ChatMessage } from '../lib/ai';
import { recordUsage, checkBudget } from '../lib/rate-limiter';

export const chatRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 8_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_ARTICLES_MULTI = 5;
const MAX_CONTENT_PER_ARTICLE_MULTI = 2_000;
const MULTI_CHAT_THREAD_ARTICLE_ID = '__multi_chat__';

function truncate(text: string | null, limit: number): string {
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) : text;
}

// ---------------------------------------------------------------------------
// Conversation memory: generate summaries + load recent context
// ---------------------------------------------------------------------------

const MAX_CONTEXT_SUMMARIES = 3;

async function loadRecentConversationSummaries(
  db: D1Database,
  userId: string,
  excludeThreadId?: string,
): Promise<string[]> {
  const rows = await dbAll<{ article_title: string | null; summary: string }>(
    db,
    `SELECT article_title, summary FROM chat_context_summaries
     WHERE user_id = ? ${excludeThreadId ? 'AND thread_id != ?' : ''}
     ORDER BY created_at DESC LIMIT ?`,
    excludeThreadId
      ? [userId, excludeThreadId, MAX_CONTEXT_SUMMARIES]
      : [userId, MAX_CONTEXT_SUMMARIES],
  );
  return rows.map(r =>
    r.article_title ? `[${r.article_title}] ${r.summary}` : r.summary,
  );
}

function extractFollowUpSuggestions(content: string): { text: string; suggestions: string[] } {
  const lines = content.split('\n');
  const suggestions: string[] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>>')) {
      const question = trimmed.slice(2).trim();
      if (question) suggestions.push(question);
    } else {
      textLines.push(line);
    }
  }

  // Trim trailing empty lines from the main text.
  while (textLines.length > 0 && textLines[textLines.length - 1].trim() === '') {
    textLines.pop();
  }

  return { text: textLines.join('\n'), suggestions };
}

async function saveConversationSummary(
  db: D1Database,
  userId: string,
  threadId: string,
  articleId: string | null,
  articleTitle: string | null,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  // Generate a short summary of this exchange (deterministic, no AI call needed).
  const userPreview = userMessage.length > 80 ? userMessage.slice(0, 80) + '...' : userMessage;
  const assistantPreview = assistantMessage.length > 150 ? assistantMessage.slice(0, 150) + '...' : assistantMessage;
  const summary = `User asked: "${userPreview}" — AI discussed: ${assistantPreview}`;

  await dbRun(
    db,
    `INSERT INTO chat_context_summaries (id, user_id, thread_id, article_id, article_title, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), userId, threadId, articleId, articleTitle, summary, Date.now()],
  );
}

// ---------------------------------------------------------------------------
// Shared: load thread + messages, format response
// ---------------------------------------------------------------------------

type ThreadRow = {
  id: string;
  user_id: string;
  article_id: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  token_count: number | null;
  provider: string | null;
  model: string | null;
  created_at: number;
};

function formatThread(t: ThreadRow) {
  return {
    id: t.id,
    article_id: t.article_id,
    title: t.title,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function formatMessage(m: MessageRow) {
  return {
    id: m.id,
    thread_id: m.thread_id,
    role: m.role,
    content: m.content,
    token_count: m.token_count ?? null,
    provider: m.provider ?? null,
    model: m.model ?? null,
    created_at: m.created_at,
  };
}

async function loadThreadResponse(db: D1Database, threadId: string) {
  const [thread, messages] = await Promise.all([
    dbGet<ThreadRow>(db, `SELECT * FROM chat_threads WHERE id = ?`, [threadId]),
    dbAll<MessageRow>(
      db,
      `SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC`,
      [threadId],
    ),
  ]);

  return {
    thread: thread ? formatThread(thread) : null,
    messages: messages.map(formatMessage),
  };
}

// ---------------------------------------------------------------------------
// GET /chat/:articleId — get existing thread + messages for user/article
// ---------------------------------------------------------------------------

chatRoutes.get('/chat/:articleId', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? LIMIT 1`,
    [userId, articleId],
  );

  if (!thread) {
    return c.json({ ok: true, data: { thread: null, messages: [] } });
  }

  const messages = await dbAll<MessageRow>(
    db,
    `SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC`,
    [thread.id],
  );

  return c.json({
    ok: true,
    data: { thread: formatThread(thread), messages: messages.map(formatMessage) },
  });
});

// ---------------------------------------------------------------------------
// POST /chat/:articleId — send a message in article chat
// ---------------------------------------------------------------------------

chatRoutes.post('/chat/:articleId', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  const body = await c.req.json<{ message: string }>();
  const message = body.message?.trim();
  if (!message) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'message is required' } }, 400);
  }

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  // 1. Find or create thread.
  let thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? LIMIT 1`,
    [userId, articleId],
  );

  const now = Date.now();
  if (!thread) {
    const threadId = nanoid();
    await dbRun(
      db,
      `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      [threadId, userId, articleId, now, now],
    );
    thread = { id: threadId, user_id: userId, article_id: articleId, title: null, created_at: now, updated_at: now };
  }

  // 2. Save user message.
  const userMsgId = nanoid();
  await dbRun(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, created_at)
     VALUES (?, ?, 'user', ?, ?)`,
    [userMsgId, thread.id, message, now],
  );

  // 3. Load article content for context.
  const article = await dbGet<{ id: string; title: string; canonical_url: string; content_text: string | null }>(
    db,
    `SELECT id, title, canonical_url, content_text FROM articles WHERE id = ?`,
    [articleId],
  );
  if (!article) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Article not found' } }, 404);
  }

  // Load summary, key points, tags in parallel.
  const [summaryRow, keyPointsRow, tagRows] = await Promise.all([
    dbGet<{ summary_text: string }>(
      db,
      `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId],
    ),
    dbGet<{ key_points_json: string }>(
      db,
      `SELECT key_points_json FROM article_key_points WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
      [articleId],
    ),
    dbAll<{ name: string }>(
      db,
      `SELECT t.name FROM tags t JOIN article_tags at2 ON at2.tag_id = t.id
       WHERE at2.article_id = ? LIMIT 10`,
      [articleId],
    ),
  ]);

  // 4. Load chat history.
  const historyRows = await dbAll<{ role: string; content: string }>(
    db,
    `SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?`,
    [thread.id, MAX_HISTORY_MESSAGES],
  );

  // 5. Load conversation memory from other threads.
  const priorSummaries = await loadRecentConversationSummaries(db, userId, thread.id);
  const memoryContext = priorSummaries.length > 0
    ? `\n\nPrevious discussions:\n${priorSummaries.map(s => `- ${s}`).join('\n')}`
    : '';

  // 6. Build AI messages.
  const systemPrompt = `You are an expert analyst discussing a news article with the user. Your role:

- Answer questions about the article with precision, citing specific passages when relevant.
- Provide deeper analysis: context, implications, what's missing, and connections to broader trends.
- Use markdown formatting: **bold** for emphasis, bullet points for lists, > for quoting the article.
- When referencing the article, use phrases like "The article states..." or "According to the piece..."
- If the user asks about something not covered in the article, clearly say so and offer related context if you can.
- Be concise but thorough. Prefer structured responses over walls of text.
- If the article has key points or a summary, use them to provide quick answers before diving deeper.
- After your response, on new lines, suggest 2-3 follow-up questions the user might want to ask. Prefix each with ">>". Example: ">> What are the implications for...?"${memoryContext}`;

  const contentText = truncate(article.content_text, MAX_CONTENT_LENGTH);

  let enrichmentContext = '';
  if (summaryRow?.summary_text) {
    enrichmentContext += `\n\n**Summary:** ${summaryRow.summary_text}`;
  }
  if (keyPointsRow?.key_points_json) {
    try {
      const points = JSON.parse(keyPointsRow.key_points_json);
      if (Array.isArray(points) && points.length > 0) {
        enrichmentContext += `\n\n**Key Points:**\n${points.map((p: string) => `- ${p}`).join('\n')}`;
      }
    } catch { /* ignore parse errors */ }
  }
  if (tagRows.length > 0) {
    enrichmentContext += `\n\n**Tags:** ${tagRows.map((r) => r.name).join(', ')}`;
  }

  const articleContext = `**Article:** ${article.title ?? 'Untitled'}\n**URL:** ${article.canonical_url ?? 'N/A'}\n\n**Content:**\n${contentText}${enrichmentContext}`;

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: articleContext },
  ];

  for (const row of historyRows) {
    chatMessages.push({
      role: row.role as 'user' | 'assistant',
      content: row.content,
    });
  }

  // 6. Budget check for non-BYOK users.
  if (!ai.isByok) {
    const budget = await checkBudget(db, userId);
    if (!budget.allowed) {
      return c.json({
        ok: false,
        error: { code: 'budget_exceeded', message: 'Daily or weekly AI budget exceeded', reset_at: budget.resetAt },
      }, 429);
    }
  }

  // 7. Call AI (streaming or standard).
  const wantStream = c.req.query('stream') === 'true';

  if (wantStream) {
    const stream = runChatStreaming(ai.provider, ai.apiKey, ai.model, chatMessages, { maxTokens: 1024 });

    // Wrap the provider stream: tee it to capture the final content for DB storage.
    const [browserStream, captureStream] = stream.tee();

    // Fire-and-forget: read capture stream to save the final message + record usage.
    (async () => {
      const reader = captureStream.getReader();
      const decoder = new TextDecoder();
      let finalContent = '';
      let finalUsage = {};
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.type === 'done') {
                finalContent = parsed.content ?? finalContent;
                finalUsage = parsed.usage ?? finalUsage;
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* stream error — save what we have */ }

      if (finalContent) {
        const aiMsgId = nanoid();
        const aiNow = Date.now();
        await dbRun(
          db,
          `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
          [aiMsgId, thread.id, finalContent, ai.provider, ai.model, aiNow],
        );
        await dbRun(db, `UPDATE chat_threads SET updated_at = ? WHERE id = ?`, [aiNow, thread.id]);
        await recordUsage(db, userId, ai.provider, ai.model, finalUsage, 'chat', ai.isByok);
        await saveConversationSummary(db, userId, thread.id, articleId, article.title, message, finalContent).catch(() => {});
      }
    })();

    return new Response(browserStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  const { content: rawAiContent, usage: chatUsage } = await runChat(
    ai.provider,
    ai.apiKey,
    ai.model,
    chatMessages,
    { maxTokens: 1024 },
  );

  // Extract follow-up suggestions from the response.
  const { text: aiContent, suggestions } = extractFollowUpSuggestions(rawAiContent);

  // 8. Save assistant message (with suggestions stripped).
  const aiMsgId = nanoid();
  const aiNow = Date.now();
  await dbRun(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
    [aiMsgId, thread.id, aiContent, ai.provider, ai.model, aiNow],
  );

  // Update thread timestamp.
  await dbRun(
    db,
    `UPDATE chat_threads SET updated_at = ? WHERE id = ?`,
    [aiNow, thread.id],
  );

  // Record usage.
  await recordUsage(db, userId, ai.provider, ai.model, chatUsage, 'chat', ai.isByok);

  // Save conversation memory (fire-and-forget).
  saveConversationSummary(db, userId, thread.id, articleId, article.title, message, aiContent).catch(() => {});

  // 9. Return full thread + suggestions.
  const response = await loadThreadResponse(db, thread.id);
  return c.json({ ok: true, data: { ...response, suggestions } });
});

// ---------------------------------------------------------------------------
// GET /chat/multi — get the multi-article chat thread
// ---------------------------------------------------------------------------

chatRoutes.get('/chat/multi', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? LIMIT 1`,
    [userId, MULTI_CHAT_THREAD_ARTICLE_ID],
  );

  if (!thread) {
    return c.json({ ok: true, data: { thread: null, messages: [] } });
  }

  const messages = await dbAll<MessageRow>(
    db,
    `SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC`,
    [thread.id],
  );

  return c.json({
    ok: true,
    data: { thread: formatThread(thread), messages: messages.map(formatMessage) },
  });
});

// ---------------------------------------------------------------------------
// POST /chat/multi — send a message in multi-article chat
// ---------------------------------------------------------------------------

chatRoutes.post('/chat/multi', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const body = await c.req.json<{ message: string }>();
  const message = body.message?.trim();
  if (!message) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'message is required' } }, 400);
  }

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  // 1. Find or create multi-chat thread.
  let thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? LIMIT 1`,
    [userId, MULTI_CHAT_THREAD_ARTICLE_ID],
  );

  const now = Date.now();
  if (!thread) {
    const threadId = nanoid();
    await dbRun(
      db,
      `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      [threadId, userId, MULTI_CHAT_THREAD_ARTICLE_ID, now, now],
    );
    thread = { id: threadId, user_id: userId, article_id: MULTI_CHAT_THREAD_ARTICLE_ID, title: null, created_at: now, updated_at: now };
  }

  // 2. Save user message.
  const userMsgId = nanoid();
  await dbRun(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, created_at)
     VALUES (?, ?, 'user', ?, ?)`,
    [userMsgId, thread.id, message, now],
  );

  // 3. Gather context from user's top recent scored articles.
  const recentArticles = await dbAll<{
    id: string;
    title: string | null;
    canonical_url: string | null;
    content_text: string | null;
    published_at: number | null;
  }>(
    db,
    `SELECT a.id, a.title, a.canonical_url, a.content_text, a.published_at
     FROM articles a
     JOIN article_scores sc ON sc.article_id = a.id AND sc.user_id = ?
     ORDER BY sc.score DESC, a.published_at DESC
     LIMIT ?`,
    [userId, MAX_ARTICLES_MULTI],
  );

  // Gather summaries and scores for those articles.
  const articleContextParts: string[] = [];
  for (const a of recentArticles) {
    const [summaryRow, scoreRow] = await Promise.all([
      dbGet<{ summary_text: string }>(
        db,
        `SELECT summary_text FROM article_summaries WHERE article_id = ? ORDER BY created_at DESC LIMIT 1`,
        [a.id],
      ),
      dbGet<{ score: number; label: string | null }>(
        db,
        `SELECT score, label FROM article_scores WHERE article_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [a.id, userId],
      ),
    ]);
    const summary = summaryRow?.summary_text ?? '';
    const score = scoreRow?.score ?? '?';
    const content = truncate(a.content_text, MAX_CONTENT_PER_ARTICLE_MULTI);

    articleContextParts.push(
      `**${a.title ?? 'Untitled'}** (score: ${score}/5)\n${summary ? `Summary: ${summary}\n` : ''}Content preview: ${content}`,
    );
  }

  const articlesContext = articleContextParts.join('\n\n---\n\n');

  // 4. Load chat history.
  const historyRows = await dbAll<{ role: string; content: string }>(
    db,
    `SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?`,
    [thread.id, MAX_HISTORY_MESSAGES],
  );

  // 5. Build AI messages.
  const systemPrompt = `You are an expert news analyst helping the user understand their recent news feed. You have context from their top ${MAX_ARTICLES_MULTI} recent articles.

Your role:
- Answer questions that span multiple articles -- comparisons, trends, connections.
- Reference specific articles by title when relevant.
- Use markdown formatting: **bold** for article titles, bullet points for lists.
- If asked about a specific topic, identify which articles cover it.
- Provide analysis that a single-article chat couldn't -- cross-article insights, contradictions, emerging patterns.
- Be concise but thorough.`;

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Here are my recent articles:\n\n${articlesContext}` },
  ];

  for (const row of historyRows) {
    chatMessages.push({
      role: row.role as 'user' | 'assistant',
      content: row.content,
    });
  }

  // 6. Budget check for non-BYOK users.
  if (!ai.isByok) {
    const budget = await checkBudget(db, userId);
    if (!budget.allowed) {
      return c.json({
        ok: false,
        error: { code: 'budget_exceeded', message: 'Daily or weekly AI budget exceeded', reset_at: budget.resetAt },
      }, 429);
    }
  }

  // 7. Call AI (streaming or standard).
  const wantStream = c.req.query('stream') === 'true';

  if (wantStream) {
    const stream = runChatStreaming(ai.provider, ai.apiKey, ai.model, chatMessages, { maxTokens: 1024 });
    const [browserStream, captureStream] = stream.tee();

    (async () => {
      const reader = captureStream.getReader();
      const decoder = new TextDecoder();
      let finalContent = '';
      let finalUsage = {};
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.type === 'done') {
                finalContent = parsed.content ?? finalContent;
                finalUsage = parsed.usage ?? finalUsage;
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* save what we have */ }

      if (finalContent) {
        const aiMsgId = nanoid();
        const aiNow = Date.now();
        await dbRun(
          db,
          `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
          [aiMsgId, thread.id, finalContent, ai.provider, ai.model, aiNow],
        );
        await dbRun(db, `UPDATE chat_threads SET updated_at = ? WHERE id = ?`, [aiNow, thread.id]);
        await recordUsage(db, userId, ai.provider, ai.model, finalUsage, 'chat_multi', ai.isByok);
      }
    })();

    return new Response(browserStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  const { content: aiContent, usage: multiChatUsage } = await runChat(
    ai.provider,
    ai.apiKey,
    ai.model,
    chatMessages,
    { maxTokens: 1024 },
  );

  // 8. Save assistant message.
  const aiMsgId = nanoid();
  const aiNow = Date.now();
  await dbRun(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
    [aiMsgId, thread.id, aiContent, ai.provider, ai.model, aiNow],
  );

  await dbRun(
    db,
    `UPDATE chat_threads SET updated_at = ? WHERE id = ?`,
    [aiNow, thread.id],
  );

  // Record usage.
  await recordUsage(db, userId, ai.provider, ai.model, multiChatUsage, 'chat_multi', ai.isByok);

  // 9. Return full thread.
  const response = await loadThreadResponse(db, thread.id);
  return c.json({ ok: true, data: response });
});
