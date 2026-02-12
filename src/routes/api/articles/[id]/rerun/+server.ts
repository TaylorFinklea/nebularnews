import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { dbRun, now } from '$lib/server/db';

const enqueueJob = async (db: D1Database, type: 'summarize' | 'summarize_chat' | 'score', articleId: string) => {
  await dbRun(
    db,
    `INSERT INTO jobs (id, type, article_id, status, attempts, run_after, last_error)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(type, article_id) DO UPDATE SET
       status = excluded.status,
       attempts = 0,
       run_after = excluded.run_after,
       last_error = NULL,
       provider = NULL,
       model = NULL`,
    [nanoid(), type, articleId, 'pending', 0, now()]
  );
};

export const POST = async ({ params, request, platform }) => {
  const body = await request.json().catch(() => ({}));
  const types = Array.isArray(body?.types) ? body.types : ['summarize', 'score'];
  const articleId = params.id;
  const allowed = new Set(['summarize', 'summarize_chat', 'score']);
  const filtered = types.filter((type: string) => allowed.has(type));
  if (filtered.length === 0) return json({ error: 'No valid types' }, { status: 400 });

  if (filtered.includes('summarize')) {
    await enqueueJob(platform.env.DB, 'summarize', articleId);
  }
  if (filtered.includes('summarize_chat')) {
    await enqueueJob(platform.env.DB, 'summarize_chat', articleId);
  }
  if (filtered.includes('score')) {
    await enqueueJob(platform.env.DB, 'score', articleId);
  }

  return json({ ok: true, queued: filtered });
};
