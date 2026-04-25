export interface Env {
  // D1 database
  DB: D1Database;

  // Auth
  BETTER_AUTH_SECRET: string;
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
  // Web counterparts. Apple treats native (App ID) and web (Services ID) as
  // distinct OAuth clients with distinct client secrets. iOS continues to
  // sign in via the App ID; admin.nebularnews.com uses the Services ID.
  APPLE_SERVICES_ID?: string;
  APPLE_CLIENT_SECRET_WEB?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // AI providers (server-side fallback keys)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;

  // Scraping providers
  STEEL_API_KEY?: string;
  BROWSERLESS_API_KEY?: string;

  // AI model config
  DEFAULT_PROVIDER: string;
  DEFAULT_MODEL_A: string;
  DEFAULT_MODEL_B: string;

  // App config
  APP_ENV: string;
  MAX_FEEDS_PER_POLL: string;
  MAX_ITEMS_PER_POLL: string;

  // APNS
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_BUNDLE_ID: string;
  APNS_SANDBOX: string;
  APNS_KEY_P8?: string;
}
