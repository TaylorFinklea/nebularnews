import { betterAuth } from 'better-auth';
import { D1Dialect } from 'kysely-d1';
import type { Env } from '../env';

export function createAuth(env: Env) {
  return betterAuth({
    database: new D1Dialect({ database: env.DB }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_ENV === 'production'
      ? 'https://api.nebularnews.com'
      : 'http://localhost:8787',
    basePath: '/api/auth',
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'member',
          input: false,
        },
      },
    },
    socialProviders: {
      apple: {
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
      },
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh every 24h
    },
    trustedOrigins: ['nebularnews://*', 'http://localhost:*'],
    advanced: {
      crossSubDomainCookies: { enabled: false },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
