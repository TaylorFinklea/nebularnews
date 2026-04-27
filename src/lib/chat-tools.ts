import { nanoid } from 'nanoid';
import type { D1Database } from '@cloudflare/workers-types';
import { dbGet, dbRun, dbAll } from '../db/helpers';
import { handleToolCall as handleMcpToolCall } from '../mcp/tools';
import { normalizeFeedURL } from './feed-url-normalizer';
import type { ToolDefinition, ToolCall } from './ai';

// ---------------------------------------------------------------------------
// Tool registry
//
// Two banks:
//   - SERVER_TOOLS: executed server-side, result fed back to the AI.
//   - CLIENT_TOOLS: forwarded to iOS verbatim via the SSE stream; iOS executes
//     locally (deep link, filter change, tab switch, etc.).
// ---------------------------------------------------------------------------

export const SERVER_TOOLS: ToolDefinition[] = [
  // Data reads — thin wrappers around existing MCP handlers.
  {
    name: 'search_articles',
    description: 'Full-text search the user\'s articles. Returns titles, scores, and summaries.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10, max 25)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_feeds',
    description: 'List the user\'s RSS feed subscriptions with titles and URLs.',
    parameters: {
      type: 'object',
      properties: {
        include_paused: { type: 'boolean', description: 'Include paused feeds (default false)' },
      },
    },
  },
  {
    name: 'get_trending_topics',
    description: 'Return trending tags across recent articles.',
    parameters: {
      type: 'object',
      properties: {
        window_hours: { type: 'number', description: 'Lookback window in hours (default 24)' },
      },
    },
  },
  {
    name: 'get_article_summary',
    description: 'Return the latest AI summary for an article.',
    parameters: {
      type: 'object',
      properties: {
        article_id: { type: 'string' },
      },
      required: ['article_id'],
    },
  },

  // Mutations.
  {
    name: 'mark_articles_read',
    description: 'Mark one or more articles as read. Use sparingly for bulk actions.',
    parameters: {
      type: 'object',
      properties: {
        article_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['article_ids'],
    },
  },
  {
    name: 'save_articles',
    description: 'Save (bookmark) one or more articles to the user\'s reading list. Idempotent.',
    parameters: {
      type: 'object',
      properties: {
        article_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['article_ids'],
    },
  },
  {
    name: 'react_to_articles',
    description: 'Record a +1 (liked) or -1 (disliked) reaction on one or more articles. Use when the user reacts to a brief bullet (which has multiple source articles) so the reaction applies to all of them.',
    parameters: {
      type: 'object',
      properties: {
        article_ids: { type: 'array', items: { type: 'string' } },
        value: { type: 'number', enum: [1, -1] },
      },
      required: ['article_ids', 'value'],
    },
  },
  {
    name: 'set_article_reaction',
    description: 'Record a +1 (liked) or -1 (disliked) reaction on an article.',
    parameters: {
      type: 'object',
      properties: {
        article_id: { type: 'string' },
        value: { type: 'number', enum: [1, -1], description: '+1 for like, -1 for dislike' },
      },
      required: ['article_id', 'value'],
    },
  },
  {
    name: 'apply_tag_to_article',
    description: 'Apply a tag to an article. Creates the tag if it does not exist.',
    parameters: {
      type: 'object',
      properties: {
        article_id: { type: 'string' },
        tag_name: { type: 'string', description: 'Human-readable tag name, e.g. "evergreen"' },
      },
      required: ['article_id', 'tag_name'],
    },
  },
  {
    name: 'set_feed_max_per_day',
    description: 'Cap the number of articles shown per day from a specific feed. Use 0 to remove the cap.',
    parameters: {
      type: 'object',
      properties: {
        feed_id: { type: 'string' },
        max_per_day: { type: 'number', description: '0 = unlimited' },
      },
      required: ['feed_id', 'max_per_day'],
    },
  },
  {
    name: 'pause_feed',
    description: 'Pause or unpause a feed subscription.',
    parameters: {
      type: 'object',
      properties: {
        feed_id: { type: 'string' },
        paused: { type: 'boolean' },
      },
      required: ['feed_id', 'paused'],
    },
  },
  {
    name: 'subscribe_to_feed',
    description: 'Subscribe the user to a new RSS feed by URL. Supports Reddit subreddits, Hacker News, Mastodon accounts, and YouTube channels (not @handles).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feed or source URL. Will be normalized to the RSS equivalent for known sources.' },
      },
      required: ['url'],
    },
  },
];

export const CLIENT_TOOLS: ToolDefinition[] = [
  {
    name: 'open_article',
    description: 'Open an article in the reader. Use after the user explicitly asks to read/view an article.',
    parameters: {
      type: 'object',
      properties: {
        article_id: { type: 'string' },
      },
      required: ['article_id'],
    },
  },
  {
    name: 'navigate_to_tab',
    description: 'Switch to a top-level tab.',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string', enum: ['today', 'articles', 'discover', 'library'] },
      },
      required: ['tab'],
    },
  },
  {
    name: 'set_articles_filter',
    description: 'Set filters on the Articles list and switch to that tab. Unspecified fields are left unchanged.',
    parameters: {
      type: 'object',
      properties: {
        read: { type: 'string', enum: ['unread', 'read', 'all'] },
        min_score: { type: 'number' },
        sort: { type: 'string', enum: ['score', 'fetched'] },
        tag: { type: 'string' },
        query: { type: 'string' },
      },
    },
  },
  {
    name: 'generate_brief_now',
    description: 'Trigger the news brief generator on the Today tab.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'dismiss_topic_request',
    description: 'Suppress a topic from future briefs for a configurable duration. Suppressions are stored client-side (privacy by design); this tool just packages the request for the iOS coordinator to write to local storage. The next brief request will include this suppression so the AI skips matching topics unless a material new development surfaces.',
    parameters: {
      type: 'object',
      properties: {
        signature: { type: 'string', description: 'Short user-readable topic descriptor, e.g. "Iraq war coverage" or "Apple OS rumors".' },
        article_ids: { type: 'array', items: { type: 'string' }, description: 'Source article ids the suppression should also cover by content fingerprint.' },
        duration_days: { type: 'number', description: 'Days the suppression is active (default 3).' },
        allow_resurface_on_developments: { type: 'boolean', description: 'If true, the AI may include articles on this topic when they describe a material new development. Default true.' },
      },
      required: ['signature', 'article_ids'],
    },
  },
];

export const ALL_TOOLS: ToolDefinition[] = [...SERVER_TOOLS, ...CLIENT_TOOLS];

const SERVER_TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.name));
const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.name));

export function isClientTool(name: string): boolean {
  return CLIENT_TOOL_NAMES.has(name);
}

export function isServerTool(name: string): boolean {
  return SERVER_TOOL_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Server-side execution
// ---------------------------------------------------------------------------

export type ToolExecutionContext = {
  userId: string;
  db: D1Database;
  req: Request;
  env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string };
};

export type ToolExecutionResult = {
  callId: string;
  name: string;
  content: string;       // text payload fed back to the AI
  summary: string;       // short human-readable line for the UI chip
  succeeded: boolean;
  /// When set, the iOS chip shows an Undo button. The tool name must be one
  /// of the UNDO_TOOL_NAMES allowlist; args are passed verbatim to the
  /// inverse executor when the user taps Undo.
  undo?: UndoSpec;
};

export type UndoSpec = {
  tool: string;
  args: Record<string, unknown>;
};

/// Allowlist for inverse tools — only these names are accepted by the
/// /chat/undo-tool endpoint, preventing replay/abuse of the undo channel
/// as a generic RPC surface.
export const UNDO_TOOL_NAMES = new Set([
  'undo_mark_articles_read',
  'undo_set_article_reaction',
  'undo_apply_tag_to_article',
  'undo_pause_feed',
  'undo_set_feed_max_per_day',
  'undo_subscribe_to_feed',
  'undo_save_articles',
  'undo_react_to_articles',
]);

export async function executeServerTool(
  call: ToolCall,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    switch (call.name) {
      case 'search_articles':
      case 'list_feeds':
      case 'get_trending_topics':
      case 'get_article_summary': {
        // Delegate to existing MCP handlers — they already return readable text.
        const mcpResult = await handleMcpToolCall(call.name, call.args, ctx);
        const text = mcpResult.content.map((c) => c.text).join('\n');
        const summary = shortSummary(call.name, call.args, text);
        return { callId: call.id, name: call.name, content: text, summary, succeeded: true };
      }

      case 'mark_articles_read': {
        const ids = Array.isArray(call.args.article_ids) ? (call.args.article_ids as string[]) : [];
        if (ids.length === 0) {
          return { callId: call.id, name: call.name, content: 'No article ids supplied.', summary: 'No articles to mark', succeeded: false };
        }
        // Filter to ids that actually exist in the articles table so hallucinated
        // ids don't return a false success.
        const placeholders = ids.map(() => '?').join(',');
        const existing = await dbAll<{ id: string }>(
          ctx.db,
          `SELECT id FROM articles WHERE id IN (${placeholders})`,
          ids,
        );
        const validIds = existing.map((r) => r.id);
        if (validIds.length === 0) {
          return { callId: call.id, name: call.name, content: 'None of the supplied article ids were found.', summary: 'Articles not found', succeeded: false };
        }
        const now = Date.now();
        for (const articleId of validIds) {
          await dbRun(
            ctx.db,
            `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(user_id, article_id) DO UPDATE SET is_read = 1, updated_at = excluded.updated_at`,
            [ctx.userId, articleId, now],
          );
        }
        const skipped = ids.length - validIds.length;
        const skipNote = skipped > 0 ? ` (${skipped} unknown id${skipped === 1 ? '' : 's'} skipped)` : '';
        return {
          callId: call.id,
          name: call.name,
          content: `Marked ${validIds.length} article(s) as read${skipNote}.`,
          summary: `Marked ${validIds.length} article${validIds.length === 1 ? '' : 's'} as read${skipNote}`,
          succeeded: true,
          undo: { tool: 'undo_mark_articles_read', args: { article_ids: validIds } },
        };
      }

      case 'save_articles': {
        const ids = Array.isArray(call.args.article_ids) ? (call.args.article_ids as string[]) : [];
        if (ids.length === 0) {
          return { callId: call.id, name: call.name, content: 'No article ids supplied.', summary: 'Nothing to save', succeeded: false };
        }
        // Validate ids before mutating so a bad id doesn't pollute the read state.
        const placeholders = ids.map(() => '?').join(',');
        const valid = await dbAll<{ id: string }>(
          ctx.db,
          `SELECT id FROM articles WHERE id IN (${placeholders})`,
          ids,
        );
        const validIds = valid.map((r) => r.id);
        if (validIds.length === 0) {
          return { callId: call.id, name: call.name, content: 'None of the supplied article ids exist.', summary: 'No articles found', succeeded: false };
        }
        const now = Date.now();
        for (const id of validIds) {
          await dbRun(
            ctx.db,
            `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, saved_at)
             VALUES (?, ?, 0, ?, ?)
             ON CONFLICT(user_id, article_id) DO UPDATE SET saved_at = excluded.saved_at, updated_at = excluded.updated_at`,
            [ctx.userId, id, now, now],
          );
        }
        const skipped = ids.length - validIds.length;
        const summary = validIds.length === 1
          ? 'Saved article'
          : `Saved ${validIds.length} articles${skipped > 0 ? ` (${skipped} not found)` : ''}`;
        return {
          callId: call.id,
          name: call.name,
          content: `Saved ${validIds.length} article${validIds.length === 1 ? '' : 's'}.`,
          summary,
          succeeded: true,
          undo: { tool: 'undo_save_articles', args: { article_ids: validIds } },
        };
      }

      case 'react_to_articles': {
        const ids = Array.isArray(call.args.article_ids) ? (call.args.article_ids as string[]) : [];
        const value = Number(call.args.value);
        if (ids.length === 0 || (value !== 1 && value !== -1)) {
          return { callId: call.id, name: call.name, content: 'Invalid arguments for react_to_articles.', summary: 'Invalid reaction args', succeeded: false };
        }
        const placeholders = ids.map(() => '?').join(',');
        // Pull each article's first feed_id for the reactions FK constraint.
        const sources = await dbAll<{ article_id: string; feed_id: string }>(
          ctx.db,
          `SELECT article_id, feed_id FROM article_sources WHERE article_id IN (${placeholders}) GROUP BY article_id`,
          ids,
        );
        if (sources.length === 0) {
          return { callId: call.id, name: call.name, content: 'No matching articles found for reaction.', summary: 'No articles found', succeeded: false };
        }
        const now = Date.now();
        for (const src of sources) {
          await dbRun(
            ctx.db,
            `INSERT INTO article_reactions (id, user_id, article_id, feed_id, value, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, article_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
            [nanoid(), ctx.userId, src.article_id, src.feed_id, value, now],
          );
        }
        const summary = `${value > 0 ? 'Liked' : 'Disliked'} ${sources.length} article${sources.length === 1 ? '' : 's'}`;
        return {
          callId: call.id,
          name: call.name,
          content: `Set reaction ${value > 0 ? '+1' : '-1'} on ${sources.length} articles.`,
          summary,
          succeeded: true,
          undo: { tool: 'undo_react_to_articles', args: { article_ids: sources.map((s) => s.article_id) } },
        };
      }

      case 'set_article_reaction': {
        const articleId = String(call.args.article_id ?? '');
        const value = Number(call.args.value);
        if (!articleId || (value !== 1 && value !== -1)) {
          return { callId: call.id, name: call.name, content: 'Invalid arguments for set_article_reaction.', summary: 'Invalid reaction', succeeded: false };
        }
        // Look up one of the article's feed_ids for the NOT NULL constraint.
        const src = await dbGet<{ feed_id: string }>(
          ctx.db,
          `SELECT feed_id FROM article_sources WHERE article_id = ? LIMIT 1`,
          [articleId],
        );
        if (!src) {
          return { callId: call.id, name: call.name, content: `Article ${articleId} not found.`, summary: 'Article not found', succeeded: false };
        }
        const now = Date.now();
        await dbRun(
          ctx.db,
          `INSERT INTO article_reactions (id, user_id, article_id, feed_id, value, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, article_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
          [nanoid(), ctx.userId, articleId, src.feed_id, value, now],
        );
        return {
          callId: call.id,
          name: call.name,
          content: `Reaction set to ${value > 0 ? 'liked' : 'disliked'}.`,
          summary: value > 0 ? 'Liked article' : 'Disliked article',
          succeeded: true,
          undo: { tool: 'undo_set_article_reaction', args: { article_id: articleId } },
        };
      }

      case 'apply_tag_to_article': {
        const articleId = String(call.args.article_id ?? '');
        const tagName = String(call.args.tag_name ?? '').trim();
        if (!articleId || !tagName) {
          return { callId: call.id, name: call.name, content: 'Missing article_id or tag_name.', summary: 'Missing tag args', succeeded: false };
        }
        const normalized = tagName.toLowerCase();
        const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const now = Date.now();

        // Upsert tag.
        let tag = await dbGet<{ id: string }>(ctx.db, `SELECT id FROM tags WHERE name_normalized = ?`, [normalized]);
        if (!tag) {
          const newId = nanoid();
          await dbRun(
            ctx.db,
            `INSERT INTO tags (id, name, name_normalized, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [newId, tagName, normalized, slug, now, now],
          );
          tag = { id: newId };
        }
        // Insert or update article_tags.
        const existing = await dbGet<{ id: string }>(
          ctx.db,
          `SELECT id FROM article_tags WHERE user_id = ? AND article_id = ? AND tag_id = ? LIMIT 1`,
          [ctx.userId, articleId, tag.id],
        );
        if (!existing) {
          await dbRun(
            ctx.db,
            `INSERT INTO article_tags (id, user_id, article_id, tag_id, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'ai', ?, ?)`,
            [nanoid(), ctx.userId, articleId, tag.id, now, now],
          );
        }
        return {
          callId: call.id,
          name: call.name,
          content: `Applied tag "${tagName}" to article ${articleId}.`,
          summary: `Applied tag "${tagName}"`,
          succeeded: true,
          undo: { tool: 'undo_apply_tag_to_article', args: { article_id: articleId, tag_id: tag.id } },
        };
      }

      case 'set_feed_max_per_day': {
        const feedId = String(call.args.feed_id ?? '');
        const cap = Math.max(0, Math.floor(Number(call.args.max_per_day)));
        if (!feedId) {
          return { callId: call.id, name: call.name, content: 'Missing feed_id.', summary: 'Missing feed', succeeded: false };
        }
        // Verify the subscription exists so we don't silently succeed on a
        // hallucinated feed_id. Also capture prior cap for undo.
        const sub = await dbGet<{ max_articles_per_day: number | null; feed_title: string | null }>(
          ctx.db,
          `SELECT s.max_articles_per_day AS max_articles_per_day, f.title AS feed_title
             FROM user_feed_subscriptions s
             LEFT JOIN feeds f ON f.id = s.feed_id
             WHERE s.user_id = ? AND s.feed_id = ?`,
          [ctx.userId, feedId],
        );
        if (!sub) {
          return { callId: call.id, name: call.name, content: `No subscription found for feed ${feedId}.`, summary: "Feed isn't subscribed", succeeded: false };
        }
        await dbRun(
          ctx.db,
          `UPDATE user_feed_subscriptions SET max_articles_per_day = ? WHERE user_id = ? AND feed_id = ?`,
          [cap > 0 ? cap : null, ctx.userId, feedId],
        );
        const label = sub.feed_title ?? feedId;
        return {
          callId: call.id,
          name: call.name,
          content: cap > 0 ? `Set cap to ${cap} articles/day for ${label}.` : `Removed daily cap for ${label}.`,
          summary: cap > 0 ? `Capped ${label} at ${cap}/day` : `Removed cap on ${label}`,
          succeeded: true,
          undo: { tool: 'undo_set_feed_max_per_day', args: { feed_id: feedId, max_per_day: sub.max_articles_per_day ?? 0 } },
        };
      }

      case 'pause_feed': {
        const feedId = String(call.args.feed_id ?? '');
        const paused = call.args.paused === true ? 1 : 0;
        if (!feedId) {
          return { callId: call.id, name: call.name, content: 'Missing feed_id.', summary: 'Missing feed', succeeded: false };
        }
        // Verify subscription exists so a bad feed_id doesn't silently succeed.
        const sub = await dbGet<{ paused: number; feed_title: string | null }>(
          ctx.db,
          `SELECT s.paused AS paused, f.title AS feed_title
             FROM user_feed_subscriptions s
             LEFT JOIN feeds f ON f.id = s.feed_id
             WHERE s.user_id = ? AND s.feed_id = ?`,
          [ctx.userId, feedId],
        );
        if (!sub) {
          return { callId: call.id, name: call.name, content: `No subscription found for feed ${feedId}.`, summary: "Feed isn't subscribed", succeeded: false };
        }
        await dbRun(
          ctx.db,
          `UPDATE user_feed_subscriptions SET paused = ? WHERE user_id = ? AND feed_id = ?`,
          [paused, ctx.userId, feedId],
        );
        const label = sub.feed_title ?? feedId;
        return {
          callId: call.id,
          name: call.name,
          content: paused ? `Paused ${label}.` : `Resumed ${label}.`,
          summary: paused ? `Paused ${label}` : `Resumed ${label}`,
          succeeded: true,
          undo: { tool: 'undo_pause_feed', args: { feed_id: feedId, paused: paused === 1 } },
        };
      }

      case 'subscribe_to_feed': {
        const rawUrl = String(call.args.url ?? '').trim();
        if (!rawUrl) {
          return { callId: call.id, name: call.name, content: 'Missing url.', summary: 'Missing URL', succeeded: false };
        }

        const normalized = normalizeFeedURL(rawUrl);
        // Guard: YouTube @handles cannot be resolved server-side and the normalizer
        // returns the original URL with a helpful sourceLabel. Don't subscribe blindly.
        if (/youtube\.com\/@/.test(normalized.url)) {
          return {
            callId: call.id, name: call.name,
            content: normalized.sourceLabel ?? 'YouTube @handle cannot be subscribed without the channel RSS URL.',
            summary: 'Need YouTube channel RSS URL',
            succeeded: false,
          };
        }

        const now = Date.now();
        let feed = await dbGet<{ id: string; title: string | null }>(
          ctx.db,
          `SELECT id, title FROM feeds WHERE url = ?`,
          [normalized.url],
        );
        if (!feed) {
          const feedId = nanoid();
          if (normalized.scrapeMode) {
            await dbRun(
              ctx.db,
              `INSERT INTO feeds (id, url, scrape_mode) VALUES (?, ?, ?)`,
              [feedId, normalized.url, normalized.scrapeMode],
            );
          } else {
            await dbRun(ctx.db, `INSERT INTO feeds (id, url) VALUES (?, ?)`, [feedId, normalized.url]);
          }
          feed = { id: feedId, title: null };
        } else if (normalized.scrapeMode) {
          await dbRun(
            ctx.db,
            `UPDATE feeds SET scrape_mode = ? WHERE id = ? AND scrape_mode = 'rss_only'`,
            [normalized.scrapeMode, feed.id],
          );
        }

        // Subscribe the user (ignore if already subscribed).
        const existing = await dbGet<{ id: string }>(
          ctx.db,
          `SELECT id FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
          [ctx.userId, feed.id],
        );
        if (existing) {
          return {
            callId: call.id, name: call.name,
            content: `Already subscribed to ${feed.title ?? normalized.url}.`,
            summary: `Already subscribed: ${feed.title ?? normalized.url}`,
            succeeded: true,
          };
        }
        await dbRun(
          ctx.db,
          `INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at) VALUES (?, ?, ?, ?)`,
          [nanoid(), ctx.userId, feed.id, now],
        );

        const label = normalized.sourceLabel
          ? `Subscribed — ${normalized.sourceLabel}`
          : `Subscribed to ${feed.title ?? normalized.url}`;
        return {
          callId: call.id,
          name: call.name,
          content: `Subscribed to ${normalized.url}. Feed id: ${feed.id}.`,
          summary: label,
          succeeded: true,
          undo: { tool: 'undo_subscribe_to_feed', args: { feed_id: feed.id } },
        };
      }

      default:
        return {
          callId: call.id,
          name: call.name,
          content: `Unknown server tool: ${call.name}`,
          summary: `Unknown tool: ${call.name}`,
          succeeded: false,
        };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack?.slice(0, 800) ?? null : null;
    // Persist full error context to debug_log so we can diagnose tool failures
    // without relying on wrangler tail. Fire-and-forget — must not throw.
    try {
      await dbRun(
        ctx.db,
        `INSERT INTO debug_log (id, created_at, scope, event, data) VALUES (?, ?, ?, ?, ?)`,
        [
          nanoid(),
          Date.now(),
          `tool-error:${call.name}`,
          'execute_failed',
          JSON.stringify({ userId: ctx.userId, callId: call.id, args: call.args, name, msg, stack }),
        ],
      );
    } catch { /* diagnostic only */ }
    return {
      callId: call.id,
      name: call.name,
      content: `Tool execution failed: ${msg}`,
      summary: `Failed: ${call.name}`,
      succeeded: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Undo executor — called by /chat/undo-tool. Only accepts tool names from
// UNDO_TOOL_NAMES; args are trusted because the undo payload was minted on
// the server during the original destructive call and echoed via SSE.
// ---------------------------------------------------------------------------

export async function executeUndoTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<{ summary: string; succeeded: boolean }> {
  if (!UNDO_TOOL_NAMES.has(toolName)) {
    return { summary: `Unknown undo action: ${toolName}`, succeeded: false };
  }

  try {
    switch (toolName) {
      case 'undo_mark_articles_read': {
        const ids = Array.isArray(args.article_ids) ? (args.article_ids as string[]) : [];
        const now = Date.now();
        for (const id of ids) {
          await dbRun(
            ctx.db,
            `UPDATE article_read_state SET is_read = 0, updated_at = ? WHERE user_id = ? AND article_id = ?`,
            [now, ctx.userId, id],
          );
        }
        return { summary: `Restored ${ids.length} article${ids.length === 1 ? '' : 's'} to unread`, succeeded: true };
      }

      case 'undo_set_article_reaction': {
        const articleId = String(args.article_id ?? '');
        await dbRun(
          ctx.db,
          `DELETE FROM article_reactions WHERE user_id = ? AND article_id = ?`,
          [ctx.userId, articleId],
        );
        return { summary: 'Reaction cleared', succeeded: true };
      }

      case 'undo_apply_tag_to_article': {
        const articleId = String(args.article_id ?? '');
        const tagId = String(args.tag_id ?? '');
        await dbRun(
          ctx.db,
          `DELETE FROM article_tags WHERE user_id = ? AND article_id = ? AND tag_id = ?`,
          [ctx.userId, articleId, tagId],
        );
        return { summary: 'Tag removed', succeeded: true };
      }

      case 'undo_save_articles': {
        const ids = Array.isArray(args.article_ids) ? (args.article_ids as string[]) : [];
        if (ids.length === 0) return { summary: 'Nothing to unsave', succeeded: false };
        const placeholders = ids.map(() => '?').join(',');
        await dbRun(
          ctx.db,
          `UPDATE article_read_state SET saved_at = NULL, updated_at = ? WHERE user_id = ? AND article_id IN (${placeholders})`,
          [Date.now(), ctx.userId, ...ids],
        );
        return { summary: ids.length === 1 ? 'Unsaved' : `Unsaved ${ids.length} articles`, succeeded: true };
      }

      case 'undo_react_to_articles': {
        const ids = Array.isArray(args.article_ids) ? (args.article_ids as string[]) : [];
        if (ids.length === 0) return { summary: 'Nothing to clear', succeeded: false };
        const placeholders = ids.map(() => '?').join(',');
        await dbRun(
          ctx.db,
          `DELETE FROM article_reactions WHERE user_id = ? AND article_id IN (${placeholders})`,
          [ctx.userId, ...ids],
        );
        return { summary: ids.length === 1 ? 'Reaction cleared' : `Cleared ${ids.length} reactions`, succeeded: true };
      }

      case 'undo_pause_feed': {
        const feedId = String(args.feed_id ?? '');
        // args.paused is the state that WAS set by the original call; the
        // inverse flips it.
        const restoreTo = args.paused === true ? 0 : 1;
        await dbRun(
          ctx.db,
          `UPDATE user_feed_subscriptions SET paused = ? WHERE user_id = ? AND feed_id = ?`,
          [restoreTo, ctx.userId, feedId],
        );
        return { summary: restoreTo === 1 ? 'Feed paused again' : 'Feed resumed', succeeded: true };
      }

      case 'undo_set_feed_max_per_day': {
        const feedId = String(args.feed_id ?? '');
        const restore = Number(args.max_per_day ?? 0);
        await dbRun(
          ctx.db,
          `UPDATE user_feed_subscriptions SET max_articles_per_day = ? WHERE user_id = ? AND feed_id = ?`,
          [restore > 0 ? restore : null, ctx.userId, feedId],
        );
        return { summary: restore > 0 ? `Restored cap to ${restore}/day` : 'Restored daily cap to default', succeeded: true };
      }

      case 'undo_subscribe_to_feed': {
        const feedId = String(args.feed_id ?? '');
        await dbRun(
          ctx.db,
          `DELETE FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?`,
          [ctx.userId, feedId],
        );
        return { summary: 'Unsubscribed', succeeded: true };
      }

      default:
        return { summary: `Unhandled undo: ${toolName}`, succeeded: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { summary: `Undo failed: ${msg}`, succeeded: false };
  }
}

function shortSummary(name: string, args: Record<string, unknown>, text: string): string {
  switch (name) {
    case 'search_articles': {
      const lines = text.split('\n').length;
      return `Searched for "${String(args.query ?? '')}" — ${Math.max(1, Math.floor(lines / 3))} result(s)`;
    }
    case 'list_feeds':
      return 'Listed feed subscriptions';
    case 'get_trending_topics':
      return 'Fetched trending topics';
    case 'get_article_summary':
      return 'Fetched article summary';
    default:
      return name;
  }
}
