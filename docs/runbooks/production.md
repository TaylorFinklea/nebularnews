# Nebular News Production Runbook

## 1) Initial Provisioning
1. Create D1 databases:
   - `nebularnews-staging`
   - `nebularnews-prod`
2. Update `/Users/tfinklea/git/nebularnews/wrangler.toml` with real `database_id` values for:
   - `[env.staging]`
   - `[env.production]`
3. Create DNS for the public MCP hostname:
   - staging equivalent if used
   - production `mcp.news.finklea.dev`
4. Configure Cloudflare Access policy in front of the app route only:
   - keep `news.finklea.dev/*` behind Access
   - do not put `mcp.news.finklea.dev/*` behind Access
5. Point both hostnames at the same Worker service and let app host routing split behavior.
4. Set required secrets in each environment:
   - `ADMIN_PASSWORD_HASH`
   - `SESSION_SECRET`
   - `ENCRYPTION_KEY`
   - `MCP_BEARER_TOKEN`
5. Set environment vars:
   - `APP_ENV` (`staging` or `production`)
   - `MCP_ALLOWED_ORIGINS` (internal MCP CORS allowlist)
   - `MCP_PUBLIC_ENABLED`
   - `MCP_PUBLIC_BASE_URL`
   - `MCP_PUBLIC_ALLOWED_ORIGINS`

## 2) Migrations
1. Staging:
   - `npm run migrate:staging`
2. Production:
   - `npm run migrate:prod`
3. Verify:
   - `GET /api/ready` returns `ok: true`
   - `schema_version` matches expected.

## 3) Deployment
1. Deploy staging:
   - `npm run deploy:staging`
2. Smoke checks:
   - `GET /api/health`
   - `GET /api/ready`
   - `GET /api/admin/preflight` (authenticated)
   - `GET https://<mcp-host>/.well-known/oauth-protected-resource`
   - `GET https://<mcp-host>/.well-known/oauth-authorization-server`
3. Deploy production:
   - `npm run deploy:prod`
4. Repeat smoke checks on production.
5. ChatGPT MCP smoke:
   - import `https://mcp.news.finklea.dev/mcp`
   - complete OAuth login/consent
   - confirm only `search`, `fetch`, and `retrieve_context_bundle` are available

## 4) Rollback
1. Re-deploy the previous known-good commit/tag to the target environment.
2. Re-run smoke checks.
3. If rollback needs data restore, follow backup/restore section.

## 5) Backup / Restore
1. Use Cloudflare D1 export/backups for point-in-time safety before migrations.
2. On bad migration/data event:
   - restore DB backup
   - deploy matching app version
   - verify `/api/ready`, `/api/admin/preflight`.

## 6) Rotation Procedures
1. Session secret rotation:
   - update `SESSION_SECRET`
   - redeploy
   - users must log in again.
2. MCP token rotation:
   - update `MCP_BEARER_TOKEN`
   - update client integrations.
3. Provider key cipher rewrap:
   - call `POST /api/keys/rotate` (authenticated).
4. Public MCP client revocation:
   - open Settings → MCP apps
   - revoke the affected client
   - confirm the client must complete OAuth again
