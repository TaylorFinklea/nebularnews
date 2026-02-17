import { nanoid } from 'nanoid';
import { dbRun, now, type Db } from './db';

export type AuditActor = 'system' | 'admin' | 'mcp';

export async function recordAuditEvent(
  db: Db,
  input: {
    actor: AuditActor;
    action: string;
    target?: string | null;
    requestId?: string | null;
    metadata?: unknown;
  }
) {
  try {
    await dbRun(
      db,
      `INSERT INTO audit_log (id, actor, action, target, metadata_json, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        input.actor,
        input.action,
        input.target ?? null,
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
        input.requestId ?? null,
        now()
      ]
    );
  } catch {
    // Best-effort logging. Never break primary request flow.
  }
}
