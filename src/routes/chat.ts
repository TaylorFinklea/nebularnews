import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbAll, dbRun } from '../db/helpers';
import { resolveAIKey } from '../lib/ai-key-resolver';
import { runChat, runChatStreaming, runChatWithTools, streamChatWithTools, type ChatMessage, type ExtendedChatMessage, type LlmUsage } from '../lib/ai';
import { recordUsage, checkBudget } from '../lib/rate-limiter';
import { buildAssistantSystemPrompt, type AssistantPageContext } from '../lib/prompts';
import { ALL_TOOLS, isClientTool, isServerTool, executeServerTool, executeUndoTool, requiresConfirmation, buildProposalDetail } from '../lib/chat-tools';

export const chatRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTENT_LENGTH = 8_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_ARTICLES_MULTI = 5;
const MAX_CONTENT_PER_ARTICLE_MULTI = 2_000;
const MULTI_CHAT_THREAD_ARTICLE_ID = '__multi_chat__';

// Maximum tool-calling rounds per assistant request. A runaway model that keeps
// requesting tool calls is capped here before it burns user tokens. Includes
// the final text turn — i.e. at MAX_TOOL_ROUNDS-1 calls we still get one more
// round to produce the final message.
const MAX_TOOL_ROUNDS = 4;

function buildProposalSummary(call: { name: string; args: Record<string, unknown> }): string {
  switch (call.name) {
    case 'mark_articles_read': {
      const ids = Array.isArray(call.args.article_ids) ? call.args.article_ids : [];
      return `Mark ${ids.length} article${ids.length === 1 ? '' : 's'} as read`;
    }
    case 'pause_feed':
      return call.args.paused === true ? 'Pause feed' : 'Resume feed';
    case 'unsubscribe_from_feed':
      return 'Unsubscribe from feed';
    case 'set_feed_max_per_day':
      return `Cap feed at ${call.args.max_per_day ?? '?'} articles/day`;
    case 'set_feed_min_score':
      return `Set minimum score to ${call.args.min_score ?? '?'}`;
    default:
      return call.name;
  }
}

function mergeUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    prompt_tokens: (a.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0),
    completion_tokens: (a.completion_tokens ?? 0) + (b.completion_tokens ?? 0),
    total_tokens: (a.total_tokens ?? 0) + (b.total_tokens ?? 0),
  };
}

function truncate(text: string | null, limit: number): string {
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) : text;
}

/// Build a stable conversation title from the user's first message.
/// Up to ~50 chars, trimmed at a word boundary, single line. Returns
/// an empty string if the input is too short to be meaningful — caller
/// then leaves `title` null until a future message provides one.
function makeHeuristicTitle(firstMessage: string): string {
  const single = firstMessage.replace(/\s+/g, ' ').trim();
  if (single.length < 3) return '';
  if (single.length <= 50) return single;
  const cut = single.slice(0, 50);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return trimmed + '…';
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
  deleted_at?: number | null;
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
  message_kind: string | null;
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
    // Default to 'text' for legacy rows that predate migration 0019.
    message_kind: m.message_kind ?? 'text',
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
//
// Special case: when articleId == '__today_brief__' the handler creates the
// thread on demand (if missing) and seeds it with a structured brief_seed
// message representing the user's latest news brief. This is what powers
// the chat-first Today tab on iOS — opening the tab loads a thread that
// always has the latest brief at the top.
// ---------------------------------------------------------------------------

const TODAY_BRIEF_ARTICLE_ID = '__today_brief__';
const ASSISTANT_THREAD_ARTICLE_ID = '__assistant__';

chatRoutes.get('/chat/:articleId{(?!assistant$|assistant/|agent$|agent/|multi$|multi/|undo-tool$|exec-tool$).+}', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const articleId = c.req.param('articleId');

  // Today and the floating AI overlay now share the assistant thread —
  // the brief is just a special message in that one conversation. Old
  // iOS clients hitting /chat/__today_brief__ get aliased to the
  // assistant thread so they pick up the seed too. New clients hit
  // /chat/assistant directly (which also seeds, see route further down).
  if (articleId === TODAY_BRIEF_ARTICLE_ID) {
    await ensureTodayBriefSeed(db, userId);
    const thread = await dbGet<ThreadRow>(
      db,
      `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [userId, ASSISTANT_THREAD_ARTICLE_ID],
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
  }

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

/**
 * Ensures the user's assistant thread contains a seeded brief_seed
 * message for their most recent news brief. Today and the floating
 * AI overlay now share one thread (article_id = __assistant__) — the
 * brief is just a special message in that conversation, so "Tell me
 * more" follow-ups, freeform chat, and the brief itself live in one
 * place. Idempotent — repeated calls are safe and only insert when the
 * latest brief hasn't been seeded yet.
 *
 * The old __today_brief__ thread is no longer written; existing rows
 * are abandoned (the user can find historical briefs via Brief
 * History). Old iOS clients hitting /chat/__today_brief__ are aliased
 * to the assistant thread in the route below.
 */
async function ensureTodayBriefSeed(db: D1Database, userId: string): Promise<void> {
  // 1. Get-or-create the assistant thread.
  let thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [userId, ASSISTANT_THREAD_ARTICLE_ID],
  );
  const now = Date.now();
  if (!thread) {
    const newId = nanoid();
    await dbRun(
      db,
      `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      [newId, userId, ASSISTANT_THREAD_ARTICLE_ID, now, now],
    );
    thread = {
      id: newId,
      user_id: userId,
      article_id: ASSISTANT_THREAD_ARTICLE_ID,
      title: null,
      created_at: now,
      updated_at: now,
    };
  }

  // 2. Find the latest completed brief.
  const latestBrief = await dbGet<{
    id: string;
    edition_kind: string;
    edition_slot: string;
    bullets_json: string;
    source_article_ids_json: string;
    generated_at: number | null;
    window_start: number;
    window_end: number;
  }>(
    db,
    `SELECT id, edition_kind, edition_slot, bullets_json, source_article_ids_json,
            generated_at, window_start, window_end
       FROM news_brief_editions
      WHERE user_id = ? AND status = 'done'
      ORDER BY COALESCE(generated_at, updated_at) DESC LIMIT 1`,
    [userId],
  );
  if (!latestBrief) return;

  // 3. Has this brief already been seeded into the thread? Match by brief_id
  // baked into the seed JSON. LIKE pattern is safe because brief ids are
  // nanoids (no glob metachars).
  const existing = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM chat_messages
      WHERE thread_id = ? AND message_kind = 'brief_seed'
        AND content LIKE ?
      LIMIT 1`,
    [thread.id, `%"brief_id":"${latestBrief.id}"%`],
  );
  if (existing) return;

  // 3a. Replace stale seeds. Today renders only one brief at a time and the
  // iOS picker is `messages.first(where: kind == brief_seed)`, which on
  // ASC-ordered messages would return the OLDEST seed. Without this delete,
  // every regenerate accumulates a new seed at the bottom that the UI
  // never picks. Wipe everything but the brand-new id, then insert.
  await dbRun(
    db,
    `DELETE FROM chat_messages
      WHERE thread_id = ? AND message_kind = 'brief_seed'`,
    [thread.id],
  );

  // 4. Insert the seed.
  let parsedBullets: unknown = [];
  let parsedSources: unknown = [];
  try { parsedBullets = JSON.parse(latestBrief.bullets_json); } catch { /* ignore */ }
  try { parsedSources = JSON.parse(latestBrief.source_article_ids_json); } catch { /* ignore */ }

  const seedContent = JSON.stringify({
    brief_id: latestBrief.id,
    edition_kind: latestBrief.edition_kind,
    edition_slot: latestBrief.edition_slot,
    generated_at: latestBrief.generated_at,
    window_start: latestBrief.window_start,
    window_end: latestBrief.window_end,
    bullets: parsedBullets,
    source_article_ids: parsedSources,
  });

  await dbRun(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, created_at, message_kind)
     VALUES (?, ?, 'assistant', ?, ?, 'brief_seed')`,
    [nanoid(), thread.id, seedContent, latestBrief.generated_at ?? now],
  );
}

// ---------------------------------------------------------------------------
// POST /chat/:articleId — send a message in article chat
// ---------------------------------------------------------------------------

chatRoutes.post('/chat/:articleId{(?!assistant$|assistant/|agent$|agent/|multi$|multi/|undo-tool$|exec-tool$).+}', async (c) => {
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

// ---------------------------------------------------------------------------
// AI Assistant — floating context-aware chat (now also the Today thread).
// Single conversation per user; opening Today and opening the floating
// overlay are two views onto the same thread.
// ---------------------------------------------------------------------------

// (ASSISTANT_THREAD_ARTICLE_ID hoisted above ensureTodayBriefSeed.)

// GET /chat/assistant — load the current assistant thread, ensuring
// the latest brief is seeded as a chat message at the bottom.
chatRoutes.get('/chat/assistant', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  // Seed (or refresh) the brief message before reading. This is what
  // makes Today render the brief as the most recent assistant message.
  await ensureTodayBriefSeed(db, userId);

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [userId, ASSISTANT_THREAD_ARTICLE_ID],
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

/// Compute a millisecond offset for the given IANA timezone at "now".
/// Positive for east-of-UTC, negative for west. Used by the
/// /chat/assistant/days endpoint to bucket chat messages into the
/// user's local day. Falls back to 0 (UTC) on any parse error.
function getTzOffsetMs(timezone: string, now: Date = new Date()): number {
  const tz = timezone || 'UTC';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now);
  } catch {
    return 0;
  }
  const pick = (type: string, fallback = '0') =>
    parseInt(parts.find((p) => p.type === type)?.value ?? fallback, 10);
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  const localAsUTC = Date.UTC(
    pick('year'), pick('month') - 1, pick('day'),
    hour, pick('minute'), pick('second'),
  );
  return localAsUTC - now.getTime();
}

/// Read the user's preferred timezone from settings (set by the news
/// brief config in /settings). Defaults to UTC. Reused by both daily
/// endpoints to keep day boundaries consistent across the API.
async function getUserTimezone(db: D1Database, userId: string): Promise<string> {
  const row = await dbGet<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE user_id = ? AND key = 'newsBriefTimezone'`,
    [userId],
  );
  return row?.value || 'UTC';
}

// GET /chat/assistant/days — days the user had chat activity in the
// shared assistant thread, newest first. Powers the iOS Daily
// Conversations history surface.
chatRoutes.get('/chat/assistant/days', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [userId, ASSISTANT_THREAD_ARTICLE_ID],
  );
  if (!thread) return c.json({ ok: true, data: { days: [] } });

  const tz = await getUserTimezone(db, userId);
  const offsetMs = getTzOffsetMs(tz);

  // Group messages by user-local day. SQLite has no arbitrary tz
  // modifier, but DATE((ms + offset) / 1000, 'unixepoch') works because
  // shifting the unix epoch by the offset turns DATE's UTC interpretation
  // into the equivalent local-day interpretation.
  type DayRow = {
    day: string;
    message_count: number;
    has_brief: number;
    preview: string | null;
  };
  const rows = await dbAll<DayRow>(
    db,
    `SELECT
        DATE((m.created_at + ?) / 1000, 'unixepoch') AS day,
        COUNT(*) AS message_count,
        MAX(CASE WHEN m.message_kind = 'brief_seed' THEN 1 ELSE 0 END) AS has_brief,
        (SELECT json_extract(content, '$.bullets[0].text')
           FROM chat_messages
          WHERE thread_id = m.thread_id
            AND DATE((created_at + ?) / 1000, 'unixepoch') = DATE((m.created_at + ?) / 1000, 'unixepoch')
            AND message_kind = 'brief_seed'
          ORDER BY created_at DESC LIMIT 1) AS preview
       FROM chat_messages m
      WHERE m.thread_id = ? AND m.role != 'system'
      GROUP BY day
      ORDER BY day DESC
      LIMIT 60`,
    [offsetMs, offsetMs, offsetMs, thread.id],
  );

  const days = rows.map((r) => ({
    day: r.day,
    message_count: r.message_count,
    has_brief: r.has_brief === 1,
    preview: r.preview,
  }));

  return c.json({ ok: true, data: { days } });
});

// GET /chat/assistant/day/:date — full message list for one local day.
chatRoutes.get('/chat/assistant/day/:date', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const date = c.req.param('date');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'date must be YYYY-MM-DD' } }, 400);
  }

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [userId, ASSISTANT_THREAD_ARTICLE_ID],
  );
  if (!thread) return c.json({ ok: false, error: { code: 'not_found', message: 'no thread' } }, 404);

  const tz = await getUserTimezone(db, userId);
  const offsetMs = getTzOffsetMs(tz);

  // Date params arrive as YYYY-MM-DD; reconstruct the local-day
  // boundaries by parsing the date as UTC and reversing the offset.
  // (offset = local_as_UTC - real_UTC, so real_UTC = local_as_UTC - offset.)
  const [y, m, d] = date.split('-').map((p) => parseInt(p, 10));
  const localStartAsUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  const startMs = localStartAsUTC - offsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;

  const messages = await dbAll<MessageRow>(
    db,
    `SELECT * FROM chat_messages
       WHERE thread_id = ? AND role != 'system'
         AND created_at >= ? AND created_at < ?
       ORDER BY created_at ASC`,
    [thread.id, startMs, endMs],
  );

  return c.json({
    ok: true,
    data: {
      day: date,
      messages: messages.map(formatMessage),
    },
  });
});

// GET /chat/assistant/history — list recent assistant threads
chatRoutes.get('/chat/assistant/history', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const threads = await dbAll<ThreadRow & { message_count: number; last_content: string | null }>(
    db,
    `SELECT t.*,
            (SELECT COUNT(*) FROM chat_messages WHERE thread_id = t.id AND role != 'system') AS message_count,
            (SELECT content FROM chat_messages WHERE thread_id = t.id AND role = 'assistant' ORDER BY created_at DESC LIMIT 1) AS last_content
     FROM chat_threads t
     WHERE t.user_id = ? AND t.article_id = ?
     ORDER BY t.updated_at DESC
     LIMIT 20`,
    [userId, ASSISTANT_THREAD_ARTICLE_ID],
  );

  const result = threads.map(t => ({
    id: t.id,
    title: t.title,
    lastMessage: t.last_content ? truncate(t.last_content, 100) : null,
    updatedAt: t.updated_at,
    messageCount: t.message_count,
  }));

  return c.json({ ok: true, data: result });
});

// POST /chat/assistant — send a message with page context
chatRoutes.post('/chat/assistant', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  try {
  const body = await c.req.json<{
    message: string;
    pageContext: AssistantPageContext;
    threadId?: string;
    /// Build 37 alias for `threadId`. Agent tab routes a message to a
    /// specific multi-conversation thread via this id.
    conversationId?: string;
    guardrails?: { policies: Record<string, 'confirm' | 'undo_only'> };
  }>();

  const message = body.message?.trim();
  if (!message) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'message is required' } }, 400);
  }

  const pageContext = body.pageContext;
  if (!pageContext?.pageType) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'pageContext is required' } }, 400);
  }

  const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
  if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

  // Budget check for non-BYOK.
  if (!ai.isByok) {
    const budget = await checkBudget(db, userId);
    if (!budget.allowed) {
      return c.json({ ok: false, error: { code: 'budget_exceeded', message: 'Budget exceeded', reset_at: budget.resetAt } }, 429);
    }
  }

  const now = Date.now();

  // Find or create assistant thread. `conversationId` (Build 37) takes
  // precedence over `threadId` (legacy). When neither is provided, fall
  // back to the user's default __assistant__ thread for backward compat
  // with iOS clients pre-Build 37 that still post to a single thread.
  const targetThreadId = body.conversationId ?? body.threadId;
  let thread: ThreadRow | null = null;
  if (targetThreadId) {
    thread = await dbGet<ThreadRow>(
      db,
      `SELECT * FROM chat_threads WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [targetThreadId, userId],
    );
    if (!thread) {
      return c.json({ ok: false, error: { code: 'not_found', message: 'Conversation not found' } }, 404);
    }
  }
  if (!thread) {
    thread = await dbGet<ThreadRow>(
      db,
      `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
      [userId, ASSISTANT_THREAD_ARTICLE_ID],
    );
  }
  if (!thread) {
    const threadId = nanoid();
    try {
      await dbRun(
        db,
        `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [threadId, userId, ASSISTANT_THREAD_ARTICLE_ID, null, now, now],
      );
    } catch (e) {
      throw e;
    }
    thread = { id: threadId, user_id: userId, article_id: ASSISTANT_THREAD_ARTICLE_ID, title: null, created_at: now, updated_at: now };
  }

  // Check for context shift — compare with last page_context_json in this thread.
  const lastContextMsg = await dbGet<{ page_context_json: string }>(
    db,
    `SELECT page_context_json FROM chat_messages WHERE thread_id = ? AND page_context_json IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [thread.id],
  );

  let contextShifted = false;
  if (lastContextMsg?.page_context_json) {
    try {
      const prev = JSON.parse(lastContextMsg.page_context_json) as AssistantPageContext;
      contextShifted = prev.pageType !== pageContext.pageType || prev.pageLabel !== pageContext.pageLabel;
    } catch { contextShifted = true; }
  } else {
    contextShifted = true; // First message — always set context
  }

  // Insert segment marker if context shifted.
  if (contextShifted) {
    const markerContent = `[Context: ${pageContext.pageLabel}]`;
    try {
      await dbRun(
        db,
        `INSERT INTO chat_messages (id, thread_id, role, content, page_context_json, created_at) VALUES (?, ?, 'system', ?, ?, ?)`,
        [nanoid(), thread.id, markerContent, JSON.stringify(pageContext), now],
      );
    } catch (e) {
      throw e;
    }
  }

  // Save user message.
  try {
    await dbRun(
      db,
      `INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
      [nanoid(), thread.id, message, now],
    );
  } catch (e) {
    throw e;
  }

  // Auto-title: when a freshly-created Agent conversation receives its
  // first user message, set the thread title from a heuristic snip of
  // that message. LLM-derived titles are queued as a Build 38 polish.
  if (!thread.title) {
    const heuristicTitle = makeHeuristicTitle(message);
    if (heuristicTitle) {
      await dbRun(
        db,
        `UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?`,
        [heuristicTitle, now, thread.id],
      ).catch(() => {});
      thread.title = heuristicTitle;
    }
  }

  // Enrich context: for article_detail, fetch full content from D1.
  if (pageContext.pageType === 'article_detail' && pageContext.articleDetail?.articleId) {
    const article = await dbGet<{ content_text: string | null }>(
      db,
      `SELECT content_text FROM articles WHERE id = ?`,
      [pageContext.articleDetail.articleId],
    );
    if (article?.content_text && pageContext.articleDetail) {
      pageContext.articleDetail.contentExcerpt = truncate(article.content_text, 4000);
    }
  }

  // For list pages with article refs, enrich source names from feeds.
  if (pageContext.articles?.length && pageContext.pageType !== 'article_detail') {
    for (const a of pageContext.articles.slice(0, 10)) {
      if (!a.source) {
        const feed = await dbGet<{ title: string }>(
          db,
          `SELECT f.title FROM feeds f JOIN article_sources asrc ON asrc.feed_id = f.id WHERE asrc.article_id = ? LIMIT 1`,
          [a.id],
        );
        if (feed) a.source = feed.title;
      }
    }
  }

  // Load conversation memory.
  const priorSummaries = await loadRecentConversationSummaries(db, userId, thread.id);

  // Build system prompt.
  const systemPrompt = buildAssistantSystemPrompt(pageContext, priorSummaries);

  // Load chat history (skip system context markers for the AI call).
  const historyRows = await dbAll<{ role: string; content: string }>(
    db,
    `SELECT role, content FROM chat_messages WHERE thread_id = ? AND role != 'system' ORDER BY created_at ASC LIMIT ?`,
    [thread.id, MAX_HISTORY_MESSAGES],
  );

  const chatMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const row of historyRows) {
    // Skip empty-content rows — these are usually tool-call-only turns we
    // persisted as assistant messages with cleanContent = ''. Feeding an
    // empty-string assistant message back to Anthropic/OpenAI is rejected
    // (empty content blocks are invalid). The tool_calls_json column keeps
    // the history record for auditing.
    if (!row.content || !row.content.trim()) continue;
    chatMessages.push({ role: row.role as 'user' | 'assistant', content: row.content });
  }

  // Stream or standard response. Both branches now loop through server-side
  // tool calls (up to MAX_TOOL_ROUNDS rounds) and forward client-side tool
  // calls to the caller via SSE / response payload.
  const wantStream = c.req.query('stream') === 'true';
  const toolCtx = { userId, db, req: c.req.raw, env: c.env };
  const guardrailPolicies: Record<string, 'confirm' | 'undo_only'> = body.guardrails?.policies ?? {};

  if (wantStream) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sse = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        const convo: ExtendedChatMessage[] = [...chatMessages];
        const toolCallLog: Array<Record<string, unknown>> = [];
        let accumulatedUsage: LlmUsage = {};
        let finalContent = '';
        let errorMessage: string | null = null;

        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            // Stream text deltas to the client as they arrive while buffering
            // tool_use blocks for post-stream execution. The done event tells us
            // whether we got plain text (break) or tool calls (continue loop).
            let roundText = '';
            let roundToolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
            let roundKind: 'message' | 'toolCalls' = 'message';
            let roundUsage: LlmUsage = {};
            for await (const evt of streamChatWithTools(ai.provider, ai.apiKey, ai.model, convo, ALL_TOOLS, { maxTokens: 1024 })) {
              if (evt.type === 'text_delta') {
                sse({ type: 'delta', content: evt.text });
              } else if (evt.type === 'done') {
                roundText = evt.finalText;
                roundToolCalls = evt.toolCalls;
                roundKind = evt.kind;
                roundUsage = evt.usage;
              }
            }
            accumulatedUsage = mergeUsage(accumulatedUsage, roundUsage);

            if (roundKind === 'message') {
              finalContent = roundText;
              break;
            }

            // Tool calls. Record the assistant's tool-use turn in the conversation.
            convo.push({ role: 'assistant', content: roundText, toolCalls: roundToolCalls });

            // Check if any call in this round requires confirmation.
            // If so, propose the first such call and halt; iOS resumes via /chat/confirm-tool.
            let proposedAndHalted = false;
            for (const call of roundToolCalls) {
              if (isServerTool(call.name) && requiresConfirmation(call, guardrailPolicies)) {
                // Build detail payload.
                const detail = await buildProposalDetail(call, toolCtx);
                const proposeId = 'tcp_' + nanoid();
                const lastUserMsg = message;
                const proposalSummary = buildProposalSummary(call);

                // Persist proposal to D1.
                try {
                  await dbRun(
                    db,
                    `INSERT INTO tool_call_proposals (id, user_id, thread_id, tool_name, args_json, preview_summary, preview_detail_json, conversation_snapshot_json, call_id, provider, model, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      proposeId,
                      userId,
                      thread.id,
                      call.name,
                      JSON.stringify(call.args),
                      proposalSummary,
                      detail ? JSON.stringify(detail) : '{}',
                      JSON.stringify(convo),
                      call.id,
                      ai.provider,
                      ai.model,
                      Date.now(),
                    ],
                  );
                } catch (e) {
                  console.error('[chat/assistant] Failed to persist proposal:', (e as Error).message);
                }

                toolCallLog.push({ kind: 'proposed', name: call.name, args: call.args, summary: proposalSummary });
                sse({
                  type: 'tool_call_propose',
                  proposeId,
                  name: call.name,
                  args: call.args,
                  summary: proposalSummary,
                  detail: detail ?? {},
                  contextHint: lastUserMsg,
                });
                proposedAndHalted = true;
                break; // Only propose one at a time.
              }
            }

            if (proposedAndHalted) {
              // Persist what we have and emit done — iOS will resume via /chat/confirm-tool.
              const { text: cleanContent } = finalContent ? extractFollowUpSuggestions(finalContent) : { text: '' };
              if (cleanContent || toolCallLog.length > 0) {
                try {
                  await dbRun(
                    db,
                    `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, tool_calls_json, created_at)
                     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
                    [
                      nanoid(), thread.id, cleanContent,
                      ai.provider, ai.model,
                      toolCallLog.length > 0 ? JSON.stringify(toolCallLog) : null,
                      Date.now(),
                    ],
                  );
                } catch (e) {
                  console.error('[assistant-persist] INSERT chat_messages (propose) failed:', (e as Error).message);
                }
              }
              break; // Exit the round loop — turn is done for now.
            }

            for (const call of roundToolCalls) {
              if (isServerTool(call.name)) {
                const execResult = await executeServerTool(call, toolCtx);
                toolCallLog.push({ kind: 'server', name: call.name, args: call.args, summary: execResult.summary, succeeded: execResult.succeeded, undo: execResult.undo ?? null });
                sse({
                  type: 'tool_call_server',
                  name: call.name,
                  summary: execResult.summary,
                  succeeded: execResult.succeeded,
                  undo: execResult.undo ?? null,
                });
                convo.push({ role: 'tool', callId: execResult.callId, content: execResult.content });
              } else if (isClientTool(call.name)) {
                toolCallLog.push({ kind: 'client', name: call.name, args: call.args });
                sse({ type: 'tool_call_client', name: call.name, args: call.args });
                // Synthetic tool result so the AI can reason about its turn completing.
                convo.push({ role: 'tool', callId: call.id, content: `Action "${call.name}" dispatched to the user's device.` });
              } else {
                sse({ type: 'tool_call_server', name: call.name, summary: `Unknown tool: ${call.name}`, succeeded: false });
                convo.push({ role: 'tool', callId: call.id, content: `Unknown tool: ${call.name}` });
              }
            }

            if (round === MAX_TOOL_ROUNDS - 1 && !finalContent) {
              errorMessage = 'tool_loop_limit';
              sse({ type: 'error', error: 'Reached tool-call limit without a final response.' });
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : 'Unknown error';
          sse({ type: 'error', error: errorMessage });
        }

        sse({ type: 'done', content: finalContent, usage: accumulatedUsage });
        controller.close();

        // Persist the assistant message with tool call log.
        const { text: cleanContent } = finalContent ? extractFollowUpSuggestions(finalContent) : { text: '' };
        if (cleanContent || toolCallLog.length > 0) {
          try {
            await dbRun(
              db,
              `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, tool_calls_json, created_at)
               VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
              [
                nanoid(), thread.id, cleanContent,
                ai.provider, ai.model,
                toolCallLog.length > 0 ? JSON.stringify(toolCallLog) : null,
                Date.now(),
              ],
            );
          } catch (e) {
            console.error('[assistant-persist] INSERT chat_messages failed:', (e as Error).message, 'thread.id=', thread.id, 'contentLen=', cleanContent.length, 'toolLog=', toolCallLog.length);
          }
          try {
            await dbRun(db, `UPDATE chat_threads SET updated_at = ? WHERE id = ?`, [Date.now(), thread.id]);
          } catch (e) {
            console.error('[assistant-persist] UPDATE chat_threads failed:', (e as Error).message);
          }
          try {
            await recordUsage(db, userId, ai.provider, ai.model, accumulatedUsage, 'assistant', ai.isByok);
          } catch (e) {
            console.error('[assistant-persist] recordUsage failed:', (e as Error).message);
          }
          if (cleanContent) {
            await saveConversationSummary(db, userId, thread.id, null, pageContext.pageLabel, message, cleanContent).catch((e) => {
              console.error('[assistant-persist] saveConversationSummary failed:', (e as Error).message);
            });
          }
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  // Non-streaming — same tool loop, collect final payload.
  const convo: ExtendedChatMessage[] = [...chatMessages];
  const toolCallLog: Array<Record<string, unknown>> = [];
  const clientCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let accumulatedUsage: LlmUsage = {};
  let finalContent = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await runChatWithTools(ai.provider, ai.apiKey, ai.model, convo, ALL_TOOLS, { maxTokens: 1024 });
    accumulatedUsage = mergeUsage(accumulatedUsage, result.usage);

    if (result.kind === 'message') {
      finalContent = result.content;
      break;
    }

    convo.push({ role: 'assistant', content: result.preface, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      if (isServerTool(call.name)) {
        const execResult = await executeServerTool(call, toolCtx);
        toolCallLog.push({ kind: 'server', name: call.name, args: call.args, summary: execResult.summary, succeeded: execResult.succeeded });
        convo.push({ role: 'tool', callId: execResult.callId, content: execResult.content });
      } else if (isClientTool(call.name)) {
        clientCalls.push({ name: call.name, args: call.args });
        toolCallLog.push({ kind: 'client', name: call.name, args: call.args });
        convo.push({ role: 'tool', callId: call.id, content: `Action "${call.name}" dispatched to the user's device.` });
      }
    }
  }

  const { text: aiContent, suggestions } = extractFollowUpSuggestions(finalContent);

  const aiMsgId = nanoid();
  const aiNow = Date.now();
  await dbRun(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, tool_calls_json, created_at)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
    [aiMsgId, thread.id, aiContent, ai.provider, ai.model, toolCallLog.length > 0 ? JSON.stringify(toolCallLog) : null, aiNow],
  );
  await dbRun(db, `UPDATE chat_threads SET updated_at = ? WHERE id = ?`, [aiNow, thread.id]);
  await recordUsage(db, userId, ai.provider, ai.model, accumulatedUsage, 'assistant', ai.isByok);
  await saveConversationSummary(db, userId, thread.id, null, pageContext.pageLabel, message, aiContent).catch(() => {});

  const response = await loadThreadResponse(db, thread.id);
  return c.json({ ok: true, data: { ...response, suggestions, clientToolCalls: clientCalls } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[chat/assistant] 500:', msg, stack);
    return c.json({ ok: false, error: { code: 'internal_error', message: msg } }, 500);
  }
});

// POST /chat/assistant/persist — record a {user, assistant} turn that the
// iOS client generated locally (free tier on-device AI via FoundationModels).
// No LLM is invoked here; the server only persists the two messages so the
// assistant thread + Daily Conversation history stay in sync. Length-capped
// per-message to bound storage; usage row records 0 tokens with provider
// 'on_device' so we can break out on-device activity in metering later.
chatRoutes.post('/chat/assistant/persist', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  try {
    const body = await c.req.json<{ user_message?: string; assistant_message?: string }>();
    const userMessage = (body.user_message ?? '').trim();
    const assistantMessage = (body.assistant_message ?? '').trim();

    if (!userMessage || !assistantMessage) {
      return c.json(
        { ok: false, error: { code: 'bad_request', message: 'user_message and assistant_message are required' } },
        400,
      );
    }
    const MAX_PERSIST_LEN = 16_000;
    if (userMessage.length > MAX_PERSIST_LEN || assistantMessage.length > MAX_PERSIST_LEN) {
      return c.json(
        { ok: false, error: { code: 'bad_request', message: `messages must be <= ${MAX_PERSIST_LEN} chars` } },
        400,
      );
    }

    // Get-or-create the assistant thread (mirrors POST /chat/assistant).
    let thread = await dbGet<ThreadRow>(
      db,
      `SELECT * FROM chat_threads WHERE user_id = ? AND article_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [userId, ASSISTANT_THREAD_ARTICLE_ID],
    );
    const now = Date.now();
    if (!thread) {
      const threadId = nanoid();
      await dbRun(
        db,
        `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [threadId, userId, ASSISTANT_THREAD_ARTICLE_ID, null, now, now],
      );
      thread = { id: threadId, user_id: userId, article_id: ASSISTANT_THREAD_ARTICLE_ID, title: null, created_at: now, updated_at: now };
    }

    const userMsgId = nanoid();
    const assistantMsgId = nanoid();
    // Assistant row is timestamped 1ms after the user row so existing
    // ORDER BY created_at queries preserve turn order.
    await dbRun(
      db,
      `INSERT INTO chat_messages (id, thread_id, role, content, provider, created_at) VALUES (?, ?, 'user', ?, 'on_device', ?)`,
      [userMsgId, thread.id, userMessage, now],
    );
    await dbRun(
      db,
      `INSERT INTO chat_messages (id, thread_id, role, content, provider, created_at) VALUES (?, ?, 'assistant', ?, 'on_device', ?)`,
      [assistantMsgId, thread.id, assistantMessage, now + 1],
    );
    await dbRun(
      db,
      `UPDATE chat_threads SET updated_at = ? WHERE id = ?`,
      [now + 1, thread.id],
    );

    // Track on-device activity in ai_usage with zero tokens. Lets metering
    // dashboards count on-device messages without inflating token totals.
    await recordUsage(db, userId, 'on_device', 'foundation_models', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, 'chat', false).catch(() => {});

    return c.json({
      ok: true,
      data: {
        thread_id: thread.id,
        user_message_id: userMsgId,
        assistant_message_id: assistantMsgId,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat/assistant/persist] 500:', msg);
    return c.json({ ok: false, error: { code: 'internal_error', message: msg } }, 500);
  }
});

// ---------------------------------------------------------------------------
// Agent conversations (Build 37) — multi-conversation ChatGPT-style surface.
//
// Each conversation = one chat_threads row. Optional pinned article_id when
// "Tell me more" or "Open in Agent" started the conversation. Title is
// auto-set from the first user message via the heuristic above.
//
// The legacy __assistant__ thread shows up here as one migrated row; iOS
// filters its brief_seed messages out of the conversation list rendering.
// ---------------------------------------------------------------------------

// GET /chat/agent/conversations — list user's conversations, newest first.
chatRoutes.get('/chat/agent/conversations', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  // Excludes the deprecated multi_chat sentinel and any thread whose
  // every message is a brief_seed (those are owned by Today's brief
  // history surface, not the Agent tab). The brief_seed-only filter is
  // a subquery that returns thread ids where ALL non-system messages
  // are brief_seed — those rows shouldn't pollute the conversation list.
  const rows = await dbAll<{
    id: string;
    article_id: string | null;
    title: string | null;
    created_at: number;
    updated_at: number;
    last_content: string | null;
    message_count: number;
  }>(
    db,
    `SELECT t.id, t.article_id, t.title, t.created_at, t.updated_at,
            (SELECT content FROM chat_messages
             WHERE thread_id = t.id AND role != 'system' AND COALESCE(message_kind, 'text') != 'brief_seed'
             ORDER BY created_at DESC LIMIT 1) AS last_content,
            (SELECT COUNT(*) FROM chat_messages
             WHERE thread_id = t.id AND role != 'system' AND COALESCE(message_kind, 'text') != 'brief_seed') AS message_count
       FROM chat_threads t
      WHERE t.user_id = ?
        AND t.deleted_at IS NULL
        AND COALESCE(t.article_id, '') != ?
        AND EXISTS (SELECT 1 FROM chat_messages m
                     WHERE m.thread_id = t.id
                       AND m.role != 'system'
                       AND COALESCE(m.message_kind, 'text') != 'brief_seed')
      ORDER BY t.updated_at DESC
      LIMIT 200`,
    [userId, MULTI_CHAT_THREAD_ARTICLE_ID],
  );

  const data = rows.map(r => ({
    id: r.id,
    article_id: r.article_id === ASSISTANT_THREAD_ARTICLE_ID ? null : r.article_id,
    // For the legacy __assistant__ thread we override any stored title
    // (e.g. "Today" from the unified-thread era) so the migrated row
    // shows up consistently as "Earlier conversation" in Agent.
    title: r.article_id === ASSISTANT_THREAD_ARTICLE_ID
      ? 'Earlier conversation'
      : (r.title ?? null),
    last_message_preview: r.last_content ? truncate(r.last_content, 120) : null,
    message_count: r.message_count,
    updated_at: r.updated_at,
    created_at: r.created_at,
    has_pinned_article: r.article_id !== null && r.article_id !== ASSISTANT_THREAD_ARTICLE_ID,
  }));

  return c.json({ ok: true, data });
});

// POST /chat/agent/conversations — create a new conversation.
chatRoutes.post('/chat/agent/conversations', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  type CreateBody = { articleId?: string | null; title?: string | null };
  const body: CreateBody = await c.req.json<CreateBody>().catch(() => ({} as CreateBody));

  const id = nanoid();
  const now = Date.now();
  const articleId = body.articleId ?? null;
  const title = body.title?.trim().slice(0, 120) || null;

  await dbRun(
    db,
    `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, articleId, title, now, now],
  );

  return c.json({
    ok: true,
    data: {
      id,
      article_id: articleId,
      title,
      created_at: now,
      updated_at: now,
      message_count: 0,
      last_message_preview: null,
      has_pinned_article: articleId !== null,
    },
  });
});

// GET /chat/agent/conversations/:id — full message list for one conversation.
chatRoutes.get('/chat/agent/conversations/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!thread) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Conversation not found' } }, 404);
  }

  // Filter out system and brief_seed rows from Agent rendering. Both
  // exist in the DB for legacy threads (especially the migrated
  // __assistant__ thread) but neither belongs in the chat surface.
  const messages = await dbAll<MessageRow>(
    db,
    `SELECT * FROM chat_messages
      WHERE thread_id = ?
        AND role != 'system'
        AND COALESCE(message_kind, 'text') != 'brief_seed'
      ORDER BY created_at ASC`,
    [thread.id],
  );

  return c.json({
    ok: true,
    data: {
      thread: {
        ...formatThread(thread),
        title: thread.article_id === ASSISTANT_THREAD_ARTICLE_ID
          ? 'Earlier conversation'
          : (thread.title ?? null),
      },
      messages: messages.map(formatMessage),
    },
  });
});

// PATCH /chat/agent/conversations/:id — rename.
chatRoutes.patch('/chat/agent/conversations/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');
  type RenameBody = { title?: string };
  const body: RenameBody = await c.req.json<RenameBody>().catch(() => ({} as RenameBody));

  const title = body.title?.trim().slice(0, 120);
  if (!title) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'title is required' } }, 400);
  }

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!thread) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Conversation not found' } }, 404);
  }

  const now = Date.now();
  await dbRun(db, `UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?`, [title, now, id]);
  return c.json({ ok: true, data: { id, title, updated_at: now } });
});

// DELETE /chat/agent/conversations/:id — soft-delete.
chatRoutes.delete('/chat/agent/conversations/:id', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const id = c.req.param('id');

  const thread = await dbGet<ThreadRow>(
    db,
    `SELECT * FROM chat_threads WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!thread) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Conversation not found' } }, 404);
  }

  const now = Date.now();
  await dbRun(db, `UPDATE chat_threads SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
  return c.json({ ok: true, data: { id } });
});

// POST /chat/exec-tool — execute a server-side chat tool directly.
//
// Used by the M18 chat-first Today tab so action chips (Save, React up/down)
// fire immediately without the AI round-trip. The payload shape mirrors
// /chat/undo-tool: { tool, args }. Only tools in the server registry are
// allowed — client tools are dispatched in iOS and don't need a server
// surface; undo tools have their own endpoint with the safer whitelist.
chatRoutes.post('/chat/exec-tool', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{ tool: string; args: Record<string, unknown> }>();
    if (!body.tool) {
      return c.json({ ok: false, error: { code: 'bad_request', message: 'tool is required' } }, 400);
    }
    if (!isServerTool(body.tool)) {
      return c.json({ ok: false, error: { code: 'forbidden', message: `Tool ${body.tool} is not a server tool` } }, 403);
    }
    const callId = nanoid();
    const result = await executeServerTool(
      { id: callId, name: body.tool, args: body.args ?? {} },
      { userId, db: c.env.DB, req: c.req.raw, env: c.env },
    );
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat/exec-tool] 500:', msg);
    return c.json({ ok: false, error: { code: 'internal_error', message: msg } }, 500);
  }
});

// POST /chat/undo-tool — reverse a destructive tool call by name + args.
// Only tools in UNDO_TOOL_NAMES are accepted. The {tool, args} payload was
// originally minted by the server and echoed via the tool_call_server SSE
// event; the iOS client stores and replays it verbatim on Undo tap.
chatRoutes.post('/chat/undo-tool', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{ tool: string; args: Record<string, unknown> }>();
    if (!body.tool) {
      return c.json({ ok: false, error: { code: 'bad_request', message: 'tool is required' } }, 400);
    }
    const result = await executeUndoTool(body.tool, body.args ?? {}, {
      userId, db: c.env.DB, req: c.req.raw, env: c.env,
    });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat/undo-tool] 500:', msg);
    return c.json({ ok: false, error: { code: 'internal_error', message: msg } }, 500);
  }
});

// POST /chat/confirm-tool — approve or reject a pending tool proposal.
// After confirmation the server resumes the SSE conversation with the tool result.
chatRoutes.post('/chat/confirm-tool', async (c) => {
  try {
    const userId = c.get('userId');
    const db = c.env.DB;

    const body = await c.req.json<{
      proposeId: string;
      decision: 'approve' | 'reject';
      edits?: Record<string, unknown>;
    }>();

    if (!body.proposeId || !body.decision) {
      return c.json({ ok: false, error: { code: 'bad_request', message: 'proposeId and decision are required' } }, 400);
    }

    // Look up proposal — must belong to this user.
    const proposal = await dbGet<{
      id: string;
      user_id: string;
      thread_id: string;
      tool_name: string;
      args_json: string;
      preview_summary: string;
      conversation_snapshot_json: string;
      call_id: string;
      provider: string;
      model: string;
      created_at: number;
      resolved_at: number | null;
      resolution: string | null;
    }>(
      db,
      `SELECT * FROM tool_call_proposals WHERE id = ? AND user_id = ?`,
      [body.proposeId, userId],
    );

    if (!proposal) {
      return c.json({ ok: false, error: { code: 'not_found', message: 'Proposal not found' } }, 404);
    }
    if (proposal.resolved_at !== null) {
      return c.json({ ok: false, error: { code: 'already_resolved', message: 'Proposal already resolved' } }, 409);
    }
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    if (proposal.created_at < tenMinutesAgo) {
      // Mark as expired.
      await dbRun(db, `UPDATE tool_call_proposals SET resolved_at = ?, resolution = 'expired' WHERE id = ?`, [Date.now(), proposal.id]);
      return c.json({ ok: false, error: { code: 'expired', message: 'Proposal expired — ask again if you still want to do this' } }, 410);
    }

    // Mark resolved.
    await dbRun(
      db,
      `UPDATE tool_call_proposals SET resolved_at = ?, resolution = ? WHERE id = ?`,
      [Date.now(), body.decision === 'approve' ? 'approved' : 'rejected', proposal.id],
    );

    const ai = await resolveAIKey(db, userId, c.req.raw, c.env);
    if (!ai) return c.json({ ok: false, error: { code: 'no_ai_key', message: 'No AI provider configured' } }, 503);

    const toolCtx = { userId, db, req: c.req.raw, env: c.env };
    const convo = JSON.parse(proposal.conversation_snapshot_json) as ExtendedChatMessage[];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sse = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        const toolCallLog: Array<Record<string, unknown>> = [];
        let accumulatedUsage: LlmUsage = {};
        let finalContent = '';

        try {
          // Build the merged args.
          const baseArgs: Record<string, unknown> = JSON.parse(proposal.args_json);
          const mergedArgs = body.edits ? { ...baseArgs, ...body.edits } : baseArgs;
          const call = { id: proposal.call_id, name: proposal.tool_name, args: mergedArgs };

          if (body.decision === 'reject') {
            // Record rejection in convo and let AI acknowledge.
            toolCallLog.push({ kind: 'rejected', name: proposal.tool_name, args: mergedArgs, summary: 'Cancelled by user' });
            sse({ type: 'tool_call_server', name: proposal.tool_name, summary: 'Cancelled by user', succeeded: false });
            convo.push({ role: 'tool', callId: proposal.call_id, content: 'User declined to run this action.' });
          } else {
            // Execute the tool.
            const execResult = await executeServerTool(call, toolCtx);
            toolCallLog.push({ kind: 'server', name: call.name, args: mergedArgs, summary: execResult.summary, succeeded: execResult.succeeded, undo: execResult.undo ?? null });
            sse({
              type: 'tool_call_server',
              name: call.name,
              summary: execResult.summary,
              succeeded: execResult.succeeded,
              undo: execResult.undo ?? null,
            });
            convo.push({ role: 'tool', callId: execResult.callId, content: execResult.content });
          }

          // Continue conversation so AI can acknowledge.
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            let roundText = '';
            let roundToolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
            let roundKind: 'message' | 'toolCalls' = 'message';
            let roundUsage: LlmUsage = {};
            for await (const evt of streamChatWithTools(ai.provider, ai.apiKey, ai.model, convo, ALL_TOOLS, { maxTokens: 1024 })) {
              if (evt.type === 'text_delta') {
                sse({ type: 'delta', content: evt.text });
              } else if (evt.type === 'done') {
                roundText = evt.finalText;
                roundToolCalls = evt.toolCalls;
                roundKind = evt.kind;
                roundUsage = evt.usage;
              }
            }
            accumulatedUsage = mergeUsage(accumulatedUsage, roundUsage);

            if (roundKind === 'message') {
              finalContent = roundText;
              break;
            }

            convo.push({ role: 'assistant', content: roundText, toolCalls: roundToolCalls });

            // Check for more proposals in follow-up rounds.
            let proposedAgain = false;
            for (const followCall of roundToolCalls) {
              if (isServerTool(followCall.name) && requiresConfirmation(followCall, {})) {
                // Propose (all-confirm defaults since we have no policy from the follow-up context).
                const detail = await buildProposalDetail(followCall, toolCtx);
                const proposeId = 'tcp_' + nanoid();
                const proposalSummary = buildProposalSummary(followCall);
                const threadId = proposal.thread_id;

                try {
                  await dbRun(
                    db,
                    `INSERT INTO tool_call_proposals (id, user_id, thread_id, tool_name, args_json, preview_summary, preview_detail_json, conversation_snapshot_json, call_id, provider, model, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      proposeId, userId, threadId, followCall.name,
                      JSON.stringify(followCall.args), proposalSummary,
                      detail ? JSON.stringify(detail) : '{}',
                      JSON.stringify(convo), followCall.id,
                      ai.provider, ai.model, Date.now(),
                    ],
                  );
                } catch { /* ignore */ }

                toolCallLog.push({ kind: 'proposed', name: followCall.name, args: followCall.args, summary: proposalSummary });
                sse({
                  type: 'tool_call_propose',
                  proposeId,
                  name: followCall.name,
                  args: followCall.args,
                  summary: proposalSummary,
                  detail: detail ?? {},
                  contextHint: null,
                });
                proposedAgain = true;
                break;
              }
            }

            if (proposedAgain) break;

            for (const followCall of roundToolCalls) {
              if (isServerTool(followCall.name)) {
                const execResult = await executeServerTool(followCall, toolCtx);
                toolCallLog.push({ kind: 'server', name: followCall.name, args: followCall.args, summary: execResult.summary, succeeded: execResult.succeeded, undo: execResult.undo ?? null });
                sse({ type: 'tool_call_server', name: followCall.name, summary: execResult.summary, succeeded: execResult.succeeded, undo: execResult.undo ?? null });
                convo.push({ role: 'tool', callId: execResult.callId, content: execResult.content });
              } else if (isClientTool(followCall.name)) {
                toolCallLog.push({ kind: 'client', name: followCall.name, args: followCall.args });
                sse({ type: 'tool_call_client', name: followCall.name, args: followCall.args });
                convo.push({ role: 'tool', callId: followCall.id, content: `Action "${followCall.name}" dispatched to the user's device.` });
              }
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('[chat/confirm-tool] stream error:', errorMessage);
          sse({ type: 'error', error: errorMessage });
        }

        sse({ type: 'done', content: finalContent, usage: accumulatedUsage });
        controller.close();

        // Persist the assistant follow-up.
        const { text: cleanContent } = finalContent ? extractFollowUpSuggestions(finalContent) : { text: '' };
        if (cleanContent || toolCallLog.length > 0) {
          try {
            await dbRun(
              db,
              `INSERT INTO chat_messages (id, thread_id, role, content, provider, model, tool_calls_json, created_at)
               VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
              [
                nanoid(), proposal.thread_id, cleanContent,
                ai.provider, ai.model,
                toolCallLog.length > 0 ? JSON.stringify(toolCallLog) : null,
                Date.now(),
              ],
            );
          } catch (e) {
            console.error('[confirm-tool-persist] INSERT failed:', (e as Error).message);
          }
          try {
            await dbRun(db, `UPDATE chat_threads SET updated_at = ? WHERE id = ?`, [Date.now(), proposal.thread_id]);
          } catch { /* ignore */ }
          try {
            await recordUsage(db, userId, ai.provider, ai.model, accumulatedUsage, 'assistant', ai.isByok);
          } catch { /* ignore */ }
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[chat/confirm-tool] 500:', msg);
    return c.json({ ok: false, error: { code: 'internal_error', message: msg } }, 500);
  }
});

// POST /chat/assistant/new — start a new assistant conversation
chatRoutes.post('/chat/assistant/new', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const now = Date.now();
  const threadId = nanoid();

  await dbRun(
    db,
    `INSERT INTO chat_threads (id, user_id, article_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [threadId, userId, ASSISTANT_THREAD_ARTICLE_ID, null, now, now],
  );

  return c.json({ ok: true, data: { threadId } });
});
