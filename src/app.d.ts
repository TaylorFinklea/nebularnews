/// <reference types="@cloudflare/workers-types" />

declare namespace App {
  interface Locals {
    user: { id: string } | null;
    requestId: string;
  }

  interface Platform {
    env: {
      DB: D1Database;
      ADMIN_PASSWORD_HASH: string;
      SESSION_SECRET: string;
      ENCRYPTION_KEY: string;
      DEFAULT_PROVIDER?: string;
      DEFAULT_MODEL?: string;
      DEFAULT_REASONING_EFFORT?: string;
      DEFAULT_INGEST_PROVIDER?: string;
      DEFAULT_INGEST_MODEL?: string;
      DEFAULT_INGEST_REASONING_EFFORT?: string;
      DEFAULT_CHAT_PROVIDER?: string;
      DEFAULT_CHAT_MODEL?: string;
      DEFAULT_CHAT_REASONING_EFFORT?: string;
      MCP_BEARER_TOKEN?: string;
      MCP_SERVER_NAME?: string;
      MCP_SERVER_VERSION?: string;
      MCP_ALLOWED_ORIGINS?: string;
      APP_ENV?: string;
      EVENTS_V2_ENABLED?: string;
      OPTIMISTIC_MUTATIONS_ENABLED?: string;
      JOB_BATCH_V2_ENABLED?: string;
      MAX_FEEDS_PER_POLL?: string;
      MAX_ITEMS_PER_POLL?: string;
      EVENTS_POLL_MS?: string;
      DASHBOARD_REFRESH_MIN_MS?: string;
      JOB_PROCESSOR_BATCH_SIZE?: string;
    };
    context: ExecutionContext;
  }
}

export {};
