# GitHub Environments Matrix

Nebular News deploys from a template-safe `wrangler.toml`. Real deployment values are injected by GitHub Actions environments and Cloudflare secrets at deploy time.

## Secrets

Set these in each GitHub Environment (`staging`, `production`) and mirror the runtime secrets in Cloudflare where required:

| Name | Required | Notes |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | yes | Worker deploy + D1 migration access |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Cloudflare account id |

Cloudflare runtime secrets that must exist for the Worker:

| Name | Required | Notes |
| --- | --- | --- |
| `ADMIN_PASSWORD_HASH` | yes | PBKDF2 hash from `npm run hash-password` |
| `SESSION_SECRET` | yes | at least 32 chars |
| `ENCRYPTION_KEY` | yes | base64-encoded 32-byte key |
| `MCP_BEARER_TOKEN` | production yes | internal MCP bearer auth |

## Environment Variables

### Shared required vars

| Variable | Staging | Production | Notes |
| --- | --- | --- | --- |
| `BASE_URL` | yes | yes | protected app host, for example `https://news.example.com` |
| `D1_DATABASE_NAME` | yes | yes | Cloudflare D1 binding target |
| `D1_DATABASE_ID` | yes | yes | real D1 database id |

### Public MCP vars

| Variable | Staging | Production | Notes |
| --- | --- | --- | --- |
| `PUBLIC_MCP_BASE_URL` | optional | yes | for example `https://mcp.example.com` |
| `PUBLIC_MCP_ALLOWED_ORIGINS` | optional | yes | usually `https://chatgpt.com,https://chat.openai.com,https://platform.openai.com` |

### Public mobile vars

| Variable | Staging | Production | Notes |
| --- | --- | --- | --- |
| `PUBLIC_MOBILE_BASE_URL` | optional | yes | for example `https://api.example.com` |
| `PUBLIC_MOBILE_ALLOWED_ORIGINS` | optional | yes | keep empty unless you intentionally allow browser clients |
| `MOBILE_OAUTH_CLIENT_ID` | optional | yes | first-party iOS client id, default `nebular-news-ios` |
| `MOBILE_OAUTH_CLIENT_NAME` | optional | yes | display name shown during OAuth consent |
| `MOBILE_OAUTH_REDIRECT_URIS` | optional | yes | comma-separated absolute redirect URIs, for example `nebularnews://oauth/callback` |

## Rendered Wrangler placeholders

`npm run render:wrangler` fills these placeholders from the environment:

- `__STAGING_D1_DATABASE_NAME__`
- `__STAGING_D1_DATABASE_ID__`
- `__PRODUCTION_D1_DATABASE_NAME__`
- `__PRODUCTION_D1_DATABASE_ID__`
- `__PRODUCTION_MCP_BASE_URL__`
- `__PRODUCTION_MCP_ALLOWED_ORIGINS__`
- `__PRODUCTION_MOBILE_BASE_URL__`
- `__PRODUCTION_MOBILE_ALLOWED_ORIGINS__`
- `__PRODUCTION_MOBILE_OAUTH_CLIENT_ID__`
- `__PRODUCTION_MOBILE_OAUTH_CLIENT_NAME__`
- `__PRODUCTION_MOBILE_OAUTH_REDIRECT_URIS__`

Do not replace these placeholders in the tracked `wrangler.toml`.

## Pre-deploy checklist

1. GitHub environment vars are set for the target environment.
2. Cloudflare secrets are present for the Worker environment.
3. DNS routes exist for the protected app host and any enabled public hosts.
4. Cloudflare Access protects only the app host.
5. `npm run check:first-party-config` passes locally and in CI.
