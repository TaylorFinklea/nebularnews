import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { envelope } from './middleware/envelope';
import { requireAuth } from './middleware/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { oauthRoutes } from './routes/oauth';
import { articleRoutes } from './routes/articles';
import { feedRoutes } from './routes/feeds';
import { tagRoutes } from './routes/tags';
import { mcpRoutes } from './routes/mcp';
import { adminRoutes } from './routes/admin';
import { pollFeeds } from './cron/poll-feeds';
import { cleanup } from './cron/cleanup';
import { retryEmptyArticles } from './cron/retry-empty-articles';

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

// Global middleware
//
// CORS: native iOS clients send no Origin header so they bypass the browser
// CORS gate entirely; the rules here only matter for the SvelteKit admin web
// (and a future consumer web). Browser flows that go through better-auth
// (e.g. /sign-in/social → cookies → callback) need credentials, which means
// the response can't be Access-Control-Allow-Origin: *. We echo the origin
// for known web hosts and for localhost dev, and otherwise drop the header
// so the request is rejected by the browser.
const ALLOWED_WEB_ORIGINS = new Set<string>([
  'https://admin.nebularnews.com',
  'https://app.nebularnews.com',
  // Claude.ai's MCP connector flow may issue browser-side fetches against
  // /authorize, /token, and /.well-known/* from claude.ai during the OAuth
  // handshake. Allow it explicitly so those requests aren't dropped.
  'https://claude.ai',
]);
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (ALLOWED_WEB_ORIGINS.has(origin)) return origin;
    if (origin.startsWith('http://localhost:')) return origin;
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['x-request-id'],
}));
app.use('*', envelope());

// Public routes (no auth required)
app.route('/api', healthRoutes);
app.route('/api', authRoutes);
// OAuth provider lives at the root path because MCP clients (Claude.ai)
// expect /authorize and /token directly under the host, plus /.well-known/
// for discovery metadata. Registering at '/' keeps these accessible from
// https://api.nebularnews.com/authorize, /token, /.well-known/...
app.route('/', oauthRoutes);

// Protected routes (auth required)
const protectedApi = new Hono<AppEnv>();
protectedApi.use('*', requireAuth());

protectedApi.route('/', articleRoutes);
protectedApi.route('/', feedRoutes);
protectedApi.route('/', tagRoutes);
protectedApi.route('/', mcpRoutes);
protectedApi.route('/', adminRoutes);

app.route('/api', protectedApi);

export default {
  fetch: app.fetch,
  scheduled: async (
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    const run = async (name: string, fn: () => Promise<void>) => {
      try { await fn(); }
      catch (err) { console.error(`[cron:${name}]`, err); }
    };
    switch (event.cron) {
      case '*/5 * * * *':
        ctx.waitUntil(run('poll-feeds', () => pollFeeds(env)));
        break;
      case '0 * * * *':
        ctx.waitUntil(run('retry-empty-articles', () => retryEmptyArticles(env)));
        break;
      case '30 3 * * *':
        ctx.waitUntil(run('cleanup', () => cleanup(env)));
        break;
    }
  },
};
