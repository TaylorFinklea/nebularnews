import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { createAuth } from '../lib/auth';

export const authRoutes = new Hono<AppEnv>();

/**
 * Mount better-auth handler at /api/auth/*
 * This handles: sign-in, sign-up, sign-out, session, social providers
 */
authRoutes.all('/auth/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});
