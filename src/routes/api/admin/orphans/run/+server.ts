import { apiError, apiOk } from '$lib/server/api';
import { recordAuditEvent } from '$lib/server/audit';
import {
  clampOrphanCleanupLimit,
  DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT,
  deleteOrphanArticlesBatch
} from '$lib/server/orphan-cleanup';

const parseBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

export const POST = async (event) => {
  const db = event.platform.env.DB;
  try {
    const body = await event.request.json().catch(() => ({}));
    const limit = clampOrphanCleanupLimit(body?.limit, DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT);
    const dryRun = parseBoolean(body?.dry_run, false);
    const result = await deleteOrphanArticlesBatch(db, limit, { dryRun });
    await recordAuditEvent(db, {
      actor: 'admin',
      action: dryRun ? 'admin.orphans.cleanup.dry_run' : 'admin.orphans.cleanup.run',
      requestId: event.locals.requestId,
      metadata: { limit, ...result }
    });
    return apiOk(event, result);
  } catch (error) {
    return apiError(
      event,
      500,
      'internal_error',
      error instanceof Error ? error.message : 'Failed to run orphan cleanup'
    );
  }
};

