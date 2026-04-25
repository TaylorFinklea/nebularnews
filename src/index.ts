import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { envelope } from './middleware/envelope';
import { requireAuth } from './middleware/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { articleRoutes } from './routes/articles';
import { feedRoutes } from './routes/feeds';
import { tagRoutes } from './routes/tags';
import { settingsRoutes } from './routes/settings';
import { todayRoutes } from './routes/today';
import { deviceRoutes } from './routes/devices';
import { onboardingRoutes } from './routes/onboarding';
import { enrichRoutes } from './routes/enrich';
import { chatRoutes } from './routes/chat';
import { briefRoutes } from './routes/brief';
import { usageRoutes } from './routes/usage';
import { mcpRoutes } from './routes/mcp';
import { subscriptionRoutes } from './routes/subscription';
import { syncRoutes } from './routes/sync';
import { insightsRoutes } from './routes/insights';
import { adminRoutes } from './routes/admin';
import { newsletterRoutes } from './routes/newsletters';
import { collectionRoutes } from './routes/collections';
import { highlightRoutes } from './routes/highlights';
import { annotationRoutes } from './routes/annotations';
import { handleEmail } from './email/handler';
import { runIntelligence } from './cron/intelligence';
import { pollFeeds } from './cron/poll-feeds';
import { scoreArticles } from './cron/score-articles';
import { cleanup } from './cron/cleanup';
import { generateScheduledBriefs } from './cron/scheduled-briefs';
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

// Protected routes (auth required)
const protectedApi = new Hono<AppEnv>();
protectedApi.use('*', requireAuth());

protectedApi.route('/', articleRoutes);
protectedApi.route('/', feedRoutes);
protectedApi.route('/', tagRoutes);
protectedApi.route('/', settingsRoutes);
protectedApi.route('/', todayRoutes);
protectedApi.route('/', deviceRoutes);
protectedApi.route('/', onboardingRoutes);

protectedApi.route('/', enrichRoutes);
protectedApi.route('/', chatRoutes);
protectedApi.route('/', briefRoutes);
protectedApi.route('/', usageRoutes);
protectedApi.route('/', mcpRoutes);
protectedApi.route('/', subscriptionRoutes);
protectedApi.route('/', syncRoutes);
protectedApi.route('/', insightsRoutes);
protectedApi.route('/', adminRoutes);
protectedApi.route('/', newsletterRoutes);
protectedApi.route('/', collectionRoutes);
protectedApi.route('/', highlightRoutes);
protectedApi.route('/', annotationRoutes);

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
        ctx.waitUntil(run('score-articles', () => scoreArticles(env)));
        ctx.waitUntil(run('scheduled-briefs', () => generateScheduledBriefs(env)));
        ctx.waitUntil(run('retry-empty-articles', () => retryEmptyArticles(env)));
        break;
      case '30 3 * * *':
        ctx.waitUntil(run('cleanup', () => cleanup(env)));
        ctx.waitUntil(run('intelligence', () => runIntelligence(env)));
        break;
    }
  },
  email: async (
    message: { from: string; to: string; raw: ReadableStream<Uint8Array>; headers: Headers },
    env: Env,
    ctx: ExecutionContext,
  ) => {
    ctx.waitUntil(handleEmail(message, env));
  },
};
