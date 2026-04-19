import { nanoid } from 'nanoid';
import type { D1Database } from '@cloudflare/workers-types';
import { dbGet, dbRun } from '../db/helpers';
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
};

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
        const now = Date.now();
        for (const articleId of ids) {
          await dbRun(
            ctx.db,
            `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(user_id, article_id) DO UPDATE SET is_read = 1, updated_at = excluded.updated_at`,
            [ctx.userId, articleId, now],
          );
        }
        return {
          callId: call.id,
          name: call.name,
          content: `Marked ${ids.length} article(s) as read.`,
          summary: `Marked ${ids.length} article${ids.length === 1 ? '' : 's'} as read`,
          succeeded: true,
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
        };
      }

      case 'set_feed_max_per_day': {
        const feedId = String(call.args.feed_id ?? '');
        const cap = Math.max(0, Math.floor(Number(call.args.max_per_day)));
        if (!feedId) {
          return { callId: call.id, name: call.name, content: 'Missing feed_id.', summary: 'Missing feed', succeeded: false };
        }
        await dbRun(
          ctx.db,
          `UPDATE user_feed_subscriptions SET max_articles_per_day = ? WHERE user_id = ? AND feed_id = ?`,
          [cap > 0 ? cap : null, ctx.userId, feedId],
        );
        return {
          callId: call.id,
          name: call.name,
          content: cap > 0 ? `Set cap to ${cap} articles/day.` : 'Removed daily cap.',
          summary: cap > 0 ? `Capped feed at ${cap}/day` : 'Removed daily cap',
          succeeded: true,
        };
      }

      case 'pause_feed': {
        const feedId = String(call.args.feed_id ?? '');
        const paused = call.args.paused === true ? 1 : 0;
        if (!feedId) {
          return { callId: call.id, name: call.name, content: 'Missing feed_id.', summary: 'Missing feed', succeeded: false };
        }
        await dbRun(
          ctx.db,
          `UPDATE user_feed_subscriptions SET paused = ? WHERE user_id = ? AND feed_id = ?`,
          [paused, ctx.userId, feedId],
        );
        return {
          callId: call.id,
          name: call.name,
          content: paused ? 'Feed paused.' : 'Feed resumed.',
          summary: paused ? 'Paused feed' : 'Resumed feed',
          succeeded: true,
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
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      callId: call.id,
      name: call.name,
      content: `Tool execution failed: ${msg}`,
      summary: `Failed: ${call.name}`,
      succeeded: false,
    };
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
