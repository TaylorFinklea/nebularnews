/**
 * Server environment variables.
 * On Cloudflare Workers these come from platform.env.
 */
export interface Env {
  SUPABASE_DB_URL: string;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  DEFAULT_PROVIDER?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_REASONING_EFFORT?: string;
  DEFAULT_MODEL_A_PROVIDER?: string;
  DEFAULT_MODEL_A?: string;
  DEFAULT_MODEL_A_REASONING_EFFORT?: string;
  DEFAULT_MODEL_B_PROVIDER?: string;
  DEFAULT_MODEL_B?: string;
  DEFAULT_MODEL_B_REASONING_EFFORT?: string;
  MCP_BEARER_TOKEN?: string;
  MCP_SERVER_NAME?: string;
  MCP_SERVER_VERSION?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_PUBLIC_ENABLED?: string;
  MCP_PUBLIC_BASE_URL?: string;
  MCP_PUBLIC_ALLOWED_ORIGINS?: string;
  MOBILE_PUBLIC_ENABLED?: string;
  MOBILE_PUBLIC_BASE_URL?: string;
  MOBILE_PUBLIC_ALLOWED_ORIGINS?: string;
  MOBILE_OAUTH_CLIENT_ID?: string;
  MOBILE_OAUTH_CLIENT_NAME?: string;
  MOBILE_OAUTH_REDIRECT_URIS?: string;
  APP_ENV?: string;
  EVENTS_V2_ENABLED?: string;
  OPTIMISTIC_MUTATIONS_ENABLED?: string;
  JOB_BATCH_V2_ENABLED?: string;
  MAX_FEEDS_PER_POLL?: string;
  MAX_ITEMS_PER_POLL?: string;
  EVENTS_POLL_MS?: string;
  DASHBOARD_REFRESH_MIN_MS?: string;
  JOB_PROCESSOR_BATCH_SIZE?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_SANDBOX?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_JWT_SECRET?: string;
}

export function getEnv(platformEnv: Record<string, string | undefined>): Env {
  return platformEnv as unknown as Env;
}
