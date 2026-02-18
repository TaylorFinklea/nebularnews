# Nebular News Incident Runbook

## Stuck pull run
Symptoms:
- Dashboard pull state stays running.
- `/api/pull/status` reports running for too long.

Actions:
1. Check `/api/admin/ops-summary` and `/api/admin/preflight`.
2. Verify latest pull run status and age.
3. Trigger a new manual pull from UI/API.
4. If persistent, inspect logs for `pull.run.failed` / feed timeouts.

## Job backlog growth
Symptoms:
- `jobs.pending` climbs and does not drain.

Actions:
1. Check `/api/admin/ops-summary` warnings.
2. Validate provider key availability and LLM errors in logs.
3. Use Jobs UI controls:
   - retry failed
   - run queue now
4. Confirm scheduled `*/5` worker runs are active in Cloudflare.

## Feed error storm
Symptoms:
- Many feeds with `error_count > 0`.

Actions:
1. Check `feeds.with_errors` in `/api/admin/ops-summary`.
2. Inspect logs for timeout/fetch failures by feed URL.
3. Temporarily disable chronically failing feeds.
4. Confirm network egress and upstream feed availability.

## Compromised token / secret
Symptoms:
- Suspicious MCP or auth activity.

Actions:
1. Rotate affected secret immediately:
   - `MCP_BEARER_TOKEN` and/or `SESSION_SECRET`.
2. Re-deploy.
3. Invalidate old client credentials.
4. Review `audit_log` for suspicious writes.

