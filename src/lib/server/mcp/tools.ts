import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpHandlers } from './handlers';

const toToolResult = (payload: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2)
    }
  ],
  structuredContent: payload
});

const toToolErrorResult = (message: string) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: message
    }
  ]
});

type Logger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

const defaultLogger: Logger = {
  info: (message) => console.info(message),
  error: (message) => console.error(message)
};

const withMetrics = <Args>(
  handlers: McpHandlers,
  toolName: string,
  logger: Logger,
  fn: (args: Args) => Promise<unknown>
) => {
  return async (args: Args) => {
    const startedAt = Date.now();
    try {
      const payload = await fn(args);
      logger.info(`[mcp] tool=${toolName} status=ok duration_ms=${Date.now() - startedAt}`);
      return toToolResult(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool call failed';
      logger.error(`[mcp] tool=${toolName} status=error duration_ms=${Date.now() - startedAt} message=${message}`);
      return toToolErrorResult(message);
    }
  };
};

export function createNebularMcpServer(input: {
  name: string;
  version: string;
  handlers: McpHandlers;
  logger?: Logger;
}) {
  const logger = input.logger ?? defaultLogger;
  const server = new McpServer({
    name: input.name,
    version: input.version
  });

  server.registerTool(
    'search',
    {
      title: 'Search Articles',
      description: 'Search Nebular News articles with a lightweight result shape.',
      inputSchema: {
        query: z.string().describe('Search query text').default(''),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(10000).default(0)
      }
    },
    withMetrics(input.handlers, 'search', logger, async (args) => input.handlers.search(args))
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch Article',
      description: 'Fetch a single article by article_id or canonical url.',
      inputSchema: {
        article_id: z.string().optional(),
        url: z.string().optional(),
        include_full_text: z.boolean().default(false),
        max_chars: z.number().int().min(1).max(30000).default(12000)
      }
    },
    withMetrics(input.handlers, 'fetch', logger, async (args) => input.handlers.fetch(args))
  );

  server.registerTool(
    'search_articles',
    {
      title: 'Search Articles (Advanced)',
      description: 'Search and filter articles with read/score/reaction/tag controls.',
      inputSchema: {
        query: z.string().default(''),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).max(10000).default(0),
        read: z.enum(['all', 'read', 'unread']).default('all'),
        sort: z.enum(['newest', 'oldest', 'score_desc', 'score_asc', 'unread_first', 'title_az']).default('newest'),
        scores: z.array(z.string()).default(['5', '4', '3', '2', '1', 'unscored']),
        reactions: z.array(z.string()).default(['up', 'down', 'none']),
        tags_all: z.array(z.string()).default([])
      }
    },
    withMetrics(input.handlers, 'search_articles', logger, async (args) => input.handlers.searchArticles(args))
  );

  server.registerTool(
    'get_article',
    {
      title: 'Get Article',
      description: 'Get a detailed article payload by article_id.',
      inputSchema: {
        article_id: z.string(),
        include_full_text: z.boolean().default(false),
        max_chars: z.number().int().min(1).max(30000).default(12000)
      }
    },
    withMetrics(input.handlers, 'get_article', logger, async (args) => input.handlers.getArticle(args))
  );

  server.registerTool(
    'retrieve_context_bundle',
    {
      title: 'Retrieve Context Bundle',
      description: 'Return top-ranked article snippets to ground external model reasoning.',
      inputSchema: {
        question: z.string(),
        max_sources: z.number().int().min(1).max(10).default(5),
        per_source_chars: z.number().int().min(300).max(5000).default(2400)
      }
    },
    withMetrics(input.handlers, 'retrieve_context_bundle', logger, async (args) =>
      input.handlers.retrieveContextBundle(args)
    )
  );

  server.registerTool(
    'set_article_read',
    {
      title: 'Set Article Read State',
      description: 'Mark an article as read or unread.',
      inputSchema: {
        article_id: z.string(),
        is_read: z.boolean()
      }
    },
    withMetrics(input.handlers, 'set_article_read', logger, async (args) => input.handlers.setArticleRead(args))
  );

  server.registerTool(
    'set_article_reaction',
    {
      title: 'Set Article Reaction',
      description: 'Set thumbs up or thumbs down for an article feed reaction.',
      inputSchema: {
        article_id: z.string(),
        reaction: z.enum(['up', 'down'])
      }
    },
    withMetrics(input.handlers, 'set_article_reaction', logger, async (args) => input.handlers.setArticleReaction(args))
  );

  server.registerTool(
    'set_article_fit_score',
    {
      title: 'Set Article Fit Score',
      description: 'Set a 1-5 fit score override for an article.',
      inputSchema: {
        article_id: z.string(),
        score: z.number().int().min(1).max(5),
        comment: z.string().optional()
      }
    },
    withMetrics(input.handlers, 'set_article_fit_score', logger, async (args) => input.handlers.setArticleFitScore(args))
  );

  server.registerTool(
    'refresh_feeds',
    {
      title: 'Refresh Feeds',
      description: 'Start a manual feed pull in the background.',
      inputSchema: {
        cycles: z.number().int().min(1).max(3).default(1)
      }
    },
    withMetrics(input.handlers, 'refresh_feeds', logger, async (args) => input.handlers.refreshFeeds(args))
  );

  server.registerTool(
    'get_pull_status',
    {
      title: 'Get Pull Status',
      description: 'Get current manual pull status.',
      inputSchema: {}
    },
    withMetrics(input.handlers, 'get_pull_status', logger, async () => input.handlers.getPullStatus())
  );

  return server;
}

