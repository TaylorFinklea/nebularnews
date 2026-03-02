import { nanoid } from 'nanoid';
import { dbRun, now, type Db } from './db';

export type ArticleJobType = 'summarize' | 'summarize_chat' | 'score' | 'key_points' | 'auto_tag';

export const enqueueArticleJob = async (
  db: Db,
  type: ArticleJobType,
  articleId: string,
  priority = 100
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
    [nanoid(), type, articleId, 'pending', 0, priority, timestamp, timestamp, timestamp]
  );
};

export const enqueueScoreJob = async (db: Db, articleId: string, priority = 100) =>
  enqueueArticleJob(db, 'score', articleId, priority);
