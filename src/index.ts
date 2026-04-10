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

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
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

// TODO: Phase 5 — mount enrich, chat, brief routes

app.route('/api', protectedApi);

export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledEvent,
    _env: Env,
    _ctx: ExecutionContext,
  ) => {
    // TODO: Phase 6 — cron handlers
  },
};
