# Nebular News Production Runbook

## 1) Topology

Use three separate hostnames:

- protected app host: `https://news.example.com`
- public MCP host: `https://mcp.example.com`
- public mobile API host: `https://api.example.com`

Route all three to the same Worker service. App code enforces host-specific allowlists.

Keep Cloudflare Access only on the protected app host. Do not place Access in front of the public MCP or public mobile hosts.

## 2) Provisioning

1. Create D1 databases for each environment.
2. Create DNS records for each enabled host.
3. Configure Cloudflare Access on the protected app host only.
4. Set GitHub Environment vars and secrets for the target environment.
5. Set Cloudflare runtime secrets for the Worker environment.

Use the matrix in [GitHub environments matrix](github-environments.md) instead of editing tracked config files with real deployment values.

## 3) Migrations

Run deterministic remote migrations before deploy:

```bash
npm run migrate:staging
npm run migrate:prod
```

Verify:

- `GET /api/ready` returns `ok: true`
- `schema_version` matches the app expectation

## 4) Deployment

Deploys should render `wrangler.generated.toml` from GitHub environment values. Do not replace placeholders in tracked `wrangler.toml`.

```bash
npm run deploy:staging
npm run deploy:prod
```

The GitHub Action already performs:

- `npm ci`
- tests
- build
- rendered Wrangler config
- remote migration
- deploy retry on transient Cloudflare API failures
- smoke checks for the protected app host
- smoke checks for public MCP metadata/challenge
- smoke checks for public mobile unauthenticated access

## 5) Post-deploy Smoke Checks

### Protected app host

- `GET https://news.example.com/api/health`
- `GET https://news.example.com/api/ready`
- authenticated `GET /api/admin/preflight`

### Public MCP host

- `GET https://mcp.example.com/.well-known/oauth-protected-resource`
- `GET https://mcp.example.com/.well-known/oauth-authorization-server`
- unauthenticated `GET https://mcp.example.com/mcp` returns `401`
- `WWW-Authenticate` points to the protected resource metadata document

### Public mobile host

- `GET https://api.example.com/api/health`
- unauthenticated `GET https://api.example.com/api/mobile/session` returns `401`
- OAuth consent flow succeeds from the iOS companion app

### Product smoke

- ChatGPT imports `https://mcp.example.com/mcp`
- ChatGPT only sees `search`, `fetch`, and `retrieve_context_bundle`
- iOS companion login completes via PKCE and can load dashboard, articles, reactions, and tags

## 6) Backup / Restore

1. Take a Cloudflare D1 backup/export before migrations that change schema or operationally sensitive data.
2. On a bad migration or bad deployment:
   - restore the D1 backup
   - redeploy the matching app version
   - verify `/api/ready`
   - verify app, MCP, and mobile host smoke checks

## 7) Rollback

1. Re-deploy the previous known-good commit or tag.
2. Re-run the smoke checks above.
3. If data shape no longer matches the rollback target, restore the matching D1 backup before declaring the rollback complete.

## 8) Revocation and Rotation

### Session secret rotation

- update `SESSION_SECRET`
- redeploy
- expect all browser sessions to be logged out

### Internal MCP bearer token rotation

- update `MCP_BEARER_TOKEN`
- redeploy
- rotate any internal MCP clients

### Provider key cipher rewrap

- call `POST /api/keys/rotate` while authenticated

### Public OAuth client/session revocation

- open Settings → Connected apps
- revoke the affected client
- confirm its access tokens and refresh tokens stop working
- force the client to complete OAuth again

## 9) Incident Notes

- If the public MCP host or mobile host starts returning non-allowlisted content, treat it as a routing regression and roll back immediately.
- If ChatGPT or the iOS app cannot complete OAuth, verify:
  - the public host DNS
  - the configured base URL
  - the redirect URI list
  - token endpoint health
  - client revocation state
