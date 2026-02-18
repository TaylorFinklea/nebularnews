# Nebular News

Nebular News is a single‑user, self‑hosted RSS intelligence hub. It ingests feeds every hour, de‑duplicates stories, extracts main content, summarizes with your own LLM keys, and lets you chat across articles with transparent fit scoring.

## Quick start

1. Install dependencies

```
npm install
```

2. Create a D1 database and apply the schema

```
wrangler d1 create nebularnews
wrangler d1 execute nebularnews --file=./schema.sql
```

3. Configure environment variables

Create a `.dev.vars` with:

```
APP_ENV=development
ADMIN_PASSWORD_HASH=pbkdf2$...
SESSION_SECRET=replace-with-long-random
ENCRYPTION_KEY=base64-32-bytes
DEFAULT_PROVIDER=openai
DEFAULT_INGEST_MODEL=gpt-5-mini
DEFAULT_CHAT_MODEL=gpt-5.2
DEFAULT_INGEST_REASONING_EFFORT=low
DEFAULT_CHAT_REASONING_EFFORT=medium
DEFAULT_REASONING_EFFORT=medium
MCP_BEARER_TOKEN=replace-with-long-random-token
MCP_SERVER_NAME=Nebular News MCP
MCP_SERVER_VERSION=0.1.0
MCP_ALLOWED_ORIGINS=
```

Generate a password hash:

```
npm run hash-password -- "your password"
```

Generate an encryption key (32 bytes, base64):

```
node -e "const { webcrypto } = require('crypto'); console.log(Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
```

4. Run locally

```
wrangler dev
```

## MCP Endpoint (`/mcp`)

Nebular News includes a Streamable HTTP MCP endpoint for external clients (including ChatGPT custom app connectors).

- Endpoint: `POST /mcp`
- Health/discovery: `GET /mcp`
- Auth: `Authorization: Bearer <MCP_BEARER_TOKEN>` (session cookie also works for local browser testing)
- Optional CORS allowlist: `MCP_ALLOWED_ORIGINS` (comma-separated). Empty means `*`.

Example probe:

```bash
curl -i http://localhost:8787/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN"
```

Example JSON-RPC initialize:

```bash
curl -s http://localhost:8787/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

### ChatGPT Custom App Notes

- Use your deployed HTTPS URL: `https://<your-domain>/mcp`
- Configure bearer auth with your `MCP_BEARER_TOKEN`
- For local testing with ChatGPT, expose localhost through a secure tunnel and use the tunnel URL.

## Health, Readiness, Pull Status, and Events

- `GET /api/health` - liveness.
- `GET /api/ready` - readiness + schema/runtime assertion.
- `GET /api/pull/status?run_id=<id>` - durable pull-run status.
- `GET /api/events` - SSE stream with pull/job state snapshots.
- `GET /api/admin/preflight` - deployment preflight checks (authenticated).
- `GET /api/admin/ops-summary` - operational snapshot (authenticated).
- `POST /api/admin/retention/run` - run retention cleanup immediately (authenticated).

`POST /api/pull` now returns a durable `run_id`.

## CSRF Notes

Mutating API routes now enforce:

- same-origin checks
- `x-csrf-token` header matching the `nn_csrf` cookie

The Nebular UI sends this automatically. Custom clients should read the cookie and echo it in `x-csrf-token`.

## Key Rotation

- `POST /api/keys/rotate`
  - Re-encrypts stored provider keys and increments `key_version`.
  - Optional JSON body: `{ "provider": "openai" | "anthropic" }`.

## Docker (Local)

Build and run:

```bash
docker build -t nebular-news .
docker run --rm -p 8787:8787 --env-file .dev.vars nebular-news
```

Inside the container, dev server runs with:
- `wrangler dev --local --host 0.0.0.0 --port 8787`

## E2E Regression (Pull Status)

This project includes a Playwright regression test for dashboard manual-pull persistence across refresh/navigation:

```
npm run test:e2e:pull
```

First-time setup for Playwright browsers:

```
npx playwright install chromium
```

Notes:
- By default, the test starts local dev on `http://127.0.0.1:8788`.
- It authenticates using `SESSION_SECRET` from `.dev.vars` (or `SESSION_SECRET` in env).
- To target an already-running instance, set `E2E_BASE_URL`.

## Deployment

`wrangler.toml` includes dedicated envs for staging and production:
- `[env.staging]`
- `[env.production]`

Update both D1 `database_id` placeholders, then set secrets per environment:

```
wrangler secret put ADMIN_PASSWORD_HASH --env staging
wrangler secret put SESSION_SECRET --env staging
wrangler secret put ENCRYPTION_KEY --env staging
wrangler secret put MCP_BEARER_TOKEN --env staging

wrangler secret put ADMIN_PASSWORD_HASH --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put ENCRYPTION_KEY --env production
wrangler secret put MCP_BEARER_TOKEN --env production
```

Run deterministic migrations:

```
npm run migrate:staging
npm run migrate:prod
```

Deploy:

```
npm run deploy:staging
npm run deploy:prod
```

Smoke-check after deploy:

```
curl -fsSL https://<host>/api/health
curl -fsSL https://<host>/api/ready
```

## Cloudflare Access (recommended)

For single-user production, put the app behind Cloudflare Access and keep app password login enabled.

Minimum policy:
- Require identity provider login for app routes.
- Restrict allowed users/groups to your account.
- Keep `/mcp` bearer token auth enabled.

## CI/CD

GitHub Actions workflow: `/Users/tfinklea/git/nebularnews/.github/workflows/cloudflare-deploy.yml`

- Push to `main` deploys staging.
- Manual dispatch can deploy staging or production.
- Pipeline gates:
  - `npm run test`
  - `npm run build`
  - remote migration
  - deploy
  - `/api/health` and `/api/ready` smoke checks

Required GitHub secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `STAGING_BASE_URL`
- `PRODUCTION_BASE_URL`

## Retention and quotas

- New settings in UI:
  - `Retention window (days)` (0 disables cleanup)
  - `Retention mode` (`archive` or `delete`)
- Scheduled cleanup runs daily at `03:30 UTC`.
- Use `/api/admin/ops-summary` warnings for backlog/data-growth guardrails.

## Runbooks

- Production runbook: `/Users/tfinklea/git/nebularnews/docs/runbooks/production.md`
- Incident runbook: `/Users/tfinklea/git/nebularnews/docs/runbooks/incidents.md`

## Notes

- Feed polling runs every 60 minutes via Cloudflare Cron triggers.
- Job queue processing runs every 5 minutes.
- Retention cleanup runs daily at 03:30 UTC.
- API keys are stored encrypted server‑side using AES‑GCM.
- You can set separate LLM defaults for pipeline jobs vs chat in Settings.
- Settings can auto-fetch available model IDs from OpenAI/Anthropic using your saved key.
- This project is licensed under AGPLv3.
