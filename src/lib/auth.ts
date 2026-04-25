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
        // For the web OAuth round-trip, Apple requires a Services ID as
        // client_id (App IDs aren't valid web clients). When the Services ID
        // env var is set, use it — iOS keeps working because it sends id_tokens
        // directly via /api/auth/sign-in/social and never hits this OAuth flow.
        clientId: env.APPLE_SERVICES_ID || env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET_WEB || env.APPLE_CLIENT_SECRET,
        // The native App ID — used as the bundle identifier when validating
        // id_tokens minted by ASAuthorizationController on iOS.
        appBundleIdentifier: env.APPLE_CLIENT_ID,
        // Allow id_tokens minted under either the App ID (iOS) or the Services
        // ID (web) to validate. Without this both flows can't share the same
        // better-auth instance.
        audience: [env.APPLE_CLIENT_ID, env.APPLE_SERVICES_ID].filter(Boolean) as string[],
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
    trustedOrigins: [
      'nebularnews://*',
      'http://localhost:*',
      'https://admin.nebularnews.com',
      'https://api.nebularnews.com',
    ],
    advanced: {
      crossSubDomainCookies: { enabled: false },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
