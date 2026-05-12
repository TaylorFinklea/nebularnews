# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Heads-up: README is stale

`README.md` describes an older, larger app (PBKDF2 admin password, schema.sql, separate public-MCP host, mobile public API, dozens of npm scripts like `hash-password`, `render:wrangler`, `check:first-party-config`, `scheduler:apply:*`, `test:e2e:pull`, `npm run build`). The current `package.json` is the v2.0.0 rewrite — a much smaller Hono Worker on D1 with better-auth + a custom OAuth provider for MCP. Trust `package.json`, `wrangler.toml`, and the code under `src/` over the README. The CI workflow (`.github/workflows/cloudflare-deploy.yml`) also references missing scripts (`build`, `render:wrangler`) and will fail as-is.

## Commands

```bash
npm run dev              # wrangler dev (local Worker on :8787)
npm run test             # vitest run (pure unit tests, node env)
npm run typecheck        # tsc --noEmit
npm run migrate:local    # apply D1 migrations to local
npm run migrate:staging  # apply migrations to remote staging D1
npm run migrate:prod     # apply migrations to remote prod D1
npm run deploy:staging
npm run deploy:prod
```

Single test: `npx vitest run src/lib/__tests__/scraper.test.ts` (or `-t "name"`).

There is no `build` step — wrangler bundles at deploy time. There is no lint config in-tree; `tsc --noEmit` is the only static check.

## Architecture

Cloudflare Worker, single entry `src/index.ts`. Hono app + `scheduled()` cron handler.

### Request layering

```
src/index.ts
  ├── envelope()        every JSON response → { ok, data } | { ok, error, request_id }
  ├── cors(...)         allowlist: admin/app.nebularnews.com, claude.ai, localhost:*
  ├── /api (public)     healthRoutes, authRoutes
  ├── /  (public)       oauthRoutes  ← root paths intentional (see below)
  ├── /api (protected)  articles, feeds, tags, mcp, admin   ← behind requireAuth()
  └── /    (protected)  mcpRoutes again, aliased at root /mcp
```

**Why MCP is mounted twice.** Claude.ai's connector wizard probes the JSON-RPC endpoint directly under the host root (`POST /mcp`), not under `/api`. The root alias in `src/index.ts` exists so the same route handlers serve both `https://host/mcp` and `https://host/api/mcp`. Don't remove the alias.

**Why OAuth lives at the root.** MCP clients (Claude.ai, Claude Desktop) expect `/authorize`, `/token`, `/register`, and `/.well-known/oauth-*` directly under the host. `oauthRoutes` is registered at `/` rather than `/api` for that reason. `better-auth` separately owns `/api/auth/*` for Apple/Google social sign-in.

### Auth: two Bearer-token paths

`src/middleware/auth.ts` validates `Authorization: Bearer <token>` against **both**:

1. `session.token` — better-auth session, set by Apple/Google sign-in (originally for iOS, still used by admin/app web after a handoff via `/api/auth/web-handoff`).
2. `oauth_access_tokens.token` — issued by the custom OAuth provider in `src/routes/oauth.ts` to MCP clients (Authorization Code + PKCE, optional Dynamic Client Registration).

Both paths set `c.var.userId` and continue. The auth middleware does **not** support cookie-only requests — it requires the Bearer header.

### Data access

D1 via thin helpers in `src/db/helpers.ts` (`dbGet`/`dbAll`/`dbRun`/`dbBatch`) — raw SQL with bound params, returns plain rows. Most routes use these directly.

`better-auth` is the only consumer of Kysely (via `kysely-d1`'s `D1Dialect`), wired in `src/lib/auth.ts`. Don't introduce Kysely elsewhere — it'd be inconsistent with the rest of the code.

Migrations live in `migrations/NNNN_name.sql` and are applied by `wrangler d1 migrations apply DB`. There is no `schema.sql` despite the README. Migration `0026_oauth_provider.sql` adds the `oauth_clients` / `oauth_authorization_codes` / `oauth_access_tokens` tables that the OAuth provider depends on.

### Cron → handler mapping (`wrangler.toml` → `src/index.ts` scheduled())

| Cron            | Calls                                                  |
|-----------------|--------------------------------------------------------|
| `*/5 * * * *`   | `pollFeeds` + `pollReddit` + `pollYoutube` (parallel)  |
| `0 * * * *`     | `retryEmptyArticles`                                   |
| `30 3 * * *`    | `cleanup`                                              |

Each is wrapped in a try/catch so one failure doesn't take the others down, and dispatched through `ctx.waitUntil`.

### Ingestion pipelines

`src/cron/poll-feeds.ts` handles `source_type IN ('rss', 'substack')` — conditional GET with ETag/Last-Modified, deduplicates by `articles.canonical_url`, optionally scrapes full content via Steel or Browserless based on `feeds.scrape_mode` (`rss_only` | `auto_fetch_on_empty` | always). Reddit and YouTube are separate pollers because their fetch shape differs (Reddit JSON; YouTube uploads Atom with no ETag support).

`src/lib/source-detect.ts` is the single source of truth for parsing user-supplied source identifiers (RSS URL, `r/sub`, `UC…` channel ID, `*.substack.com`) into `{ type, url }` — used by both the HTTP `POST /api/feeds` route and the MCP `add_feed` tool so both surfaces accept the same shorthand.

### MCP surface

JSON-RPC 2.0 over HTTP in `src/routes/mcp.ts`. Tool definitions and dispatch are in `src/mcp/tools.ts`, resources in `src/mcp/resources.ts`. Tools (`list_feeds`, `add_feed`, `remove_feed`, `get_recent`, `search_articles`, `get_article`) are deliberately retrieval-only — the LLM does ranking and summarization, the server does not call any AI provider.

Protocol version is pinned to `2024-11-05` in `mcpRoutes`. `serverInfo` carries non-standard `title` / `iconUrl` fields that Claude.ai's connector card reads for branding.

## Conventions

- **Response shape**: every JSON response is enveloped by the `envelope()` middleware. Routes do `c.json({ ok: true, data: ... })` or `c.json({ ok: false, error: { code, message } }, status)`. Don't return bare data — it bypasses the envelope contract clients depend on.
- **Path alias**: `$lib/*` → `src/lib/*` is configured in `tsconfig.json` (use it when imports would otherwise be deeply relative).
- **Tests**: only pure-function unit tests under `src/**/__tests__/**/*.test.ts`, no Miniflare. `vitest.config.ts` explicitly avoids `@cloudflare/vitest-pool-workers` — when adding tests, keep them pure or extract the pure core; don't add the workers pool without a real reason.
- **Comments in route files** are load-bearing — they document non-obvious decisions like the OAuth-at-root, the MCP-root-alias, and the two-path auth. Read them before refactoring routes.
