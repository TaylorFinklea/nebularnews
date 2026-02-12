/// <reference types="@cloudflare/workers-types" />

declare namespace App {
  interface Locals {
    user: { id: string } | null;
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
    };
    context: ExecutionContext;
  }
}

export {};
