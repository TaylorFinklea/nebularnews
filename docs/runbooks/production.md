# Nebular News Production Runbook

## 1) Initial Provisioning
1. Create D1 databases:
   - `nebularnews-staging`
   - `nebularnews-prod`
2. Update `/Users/tfinklea/git/nebularnews/wrangler.toml` with real `database_id` values for:
   - `[env.staging]`
   - `[env.production]`
3. Configure Cloudflare Access policy in front of the app route.
4. Set required secrets in each environment:
   - `ADMIN_PASSWORD_HASH`
   - `SESSION_SECRET`
   - `ENCRYPTION_KEY`
   - `MCP_BEARER_TOKEN`
5. Set environment vars:
   - `APP_ENV` (`staging` or `production`)
   - `MCP_ALLOWED_ORIGINS` (production allowlist, comma-separated)

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
3. Deploy production:
   - `npm run deploy:prod`
4. Repeat smoke checks on production.

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

