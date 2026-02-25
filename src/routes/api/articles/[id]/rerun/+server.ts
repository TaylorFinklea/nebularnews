import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbRun, now } from '$lib/server/db';
import { getAutoTaggingEnabled } from '$lib/server/settings';

const enqueueJob = async (
  db: D1Database,
  type: 'summarize' | 'summarize_chat' | 'score' | 'key_points' | 'auto_tag',
  articleId: string
) => {
  const timestamp = now();
  await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, priority, run_after, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       priority = excluded.priority,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL,
       locked_by = NULL,
       locked_at = NULL,
       lease_expires_at = NULL,
       updated_at = excluded.updated_at`,
    [nanoid(), type, articleId, 'pending', 0, 100, timestamp, timestamp, timestamp]
  );
};

export const POST = async ({ params, request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const types = Array.isArray(body?.types) ? body.types : ['summarize', 'score'];
  const articleId = params.id;
  const allowed = new Set(['summarize', 'summarize_chat', 'score', 'key_points', 'auto_tag']);
  let filtered = types.filter((type: string) => allowed.has(type));
  const autoTaggingEnabled = await getAutoTaggingEnabled(platform.env.DB);
  if (!autoTaggingEnabled) {
    filtered = filtered.filter((type: string) => type !== 'auto_tag');
  }
  if (filtered.length === 0) {
    if (!autoTaggingEnabled && types.includes('auto_tag')) {
      return json({ error: 'AI auto-tagging is disabled in Settings' }, { status: 400 });
    }
    return json({ error: 'No valid types' }, { status: 400 });
  }

  if (filtered.includes('summarize')) {
    await enqueueJob(platform.env.DB, 'summarize', articleId);
  }
  if (filtered.includes('summarize_chat')) {
    await enqueueJob(platform.env.DB, 'summarize_chat', articleId);
  }
  if (filtered.includes('score')) {
    await enqueueJob(platform.env.DB, 'score', articleId);
  }
  if (filtered.includes('key_points')) {
    await enqueueJob(platform.env.DB, 'key_points', articleId);
  }
  if (filtered.includes('auto_tag')) {
    await enqueueJob(platform.env.DB, 'auto_tag', articleId);
  }

  return json({ ok: true, queued: filtered });
};
