/// <reference types="@cloudflare/workers-types" />
import type { Db } from '$lib/server/db';
import type { Env } from '$lib/server/env';

declare namespace App {
  interface Locals {
    user: { id: string; role: 'admin' | 'member' } | null;
    requestId: string;
    db: Db;
    env: Env;
  }
  interface Platform {
    env: Env & Record<string, string | undefined>;
    context: ExecutionContext;
  }
}

export {};
