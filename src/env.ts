export interface Env {
  // D1 database
  DB: D1Database;

  // Auth — better-auth + Apple/Google social
  BETTER_AUTH_SECRET: string;
  APPLE_CLIENT_ID: string;
  APPLE_CLIENT_SECRET: string;
  // Apple treats native (App ID) and web (Services ID) as distinct OAuth
  // clients with distinct client secrets.
  APPLE_SERVICES_ID?: string;
  APPLE_CLIENT_SECRET_WEB?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  // R2 buckets — admin fallback images.
  R2_FALLBACK: R2Bucket;

  // Image generation for admin fallback-image tooling.
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;

  // Scraping providers — content extraction for full-text articles.
  STEEL_API_KEY?: string;
  BROWSERLESS_API_KEY?: string;

  // App config.
  APP_ENV: string;
  MAX_FEEDS_PER_POLL: string;
  MAX_ITEMS_PER_POLL: string;
}
