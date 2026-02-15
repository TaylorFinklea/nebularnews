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

Update `wrangler.toml` with your D1 `database_id`. Then set secrets:

```
wrangler secret put ADMIN_PASSWORD_HASH
wrangler secret put SESSION_SECRET
wrangler secret put ENCRYPTION_KEY
wrangler secret put MCP_BEARER_TOKEN
```

Deploy:

```
wrangler deploy
```

## Notes

- Feed polling runs every 60 minutes via Cloudflare Cron triggers.
- API keys are stored encrypted server‑side using AES‑GCM.
- You can set separate LLM defaults for pipeline jobs vs chat in Settings.
- Settings can auto-fetch available model IDs from OpenAI/Anthropic using your saved key.
- This project is licensed under AGPLv3.
