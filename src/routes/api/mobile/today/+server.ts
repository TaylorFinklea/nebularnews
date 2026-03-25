import { json } from '@sveltejs/kit';
import { dbGet } from '$lib/server/db';
import { requireMobileAccess } from '$lib/server/mobile/auth';
import { getDashboardNewsBrief } from '$lib/server/news-brief';
import { getDashboardQueueConfig } from '$lib/server/settings';
import { getDashboardReadingMomentum } from '$lib/server/dashboard';
import {
  listArticlesWithFilters,
  SCORE_VALUES,
  REACTION_VALUES
} from '$lib/server/article-query';

const DAY_MS = 1000 * 60 * 60 * 24;

export const GET = async ({ request, platform }) => {
  const { user } = await requireMobileAccess(request, platform.env, platform.env.DB, 'app:read');

  const db = platform.env.DB;
  const referenceAt = Date.now();
  const queueConfig = await getDashboardQueueConfig(db);

  const [newsBrief, momentum, topUnread] = await Promise.all([
    getDashboardNewsBrief(db, platform.env, referenceAt),
    getDashboardReadingMomentum(db, user.id, {
      scoreCutoff: queueConfig.scoreCutoff,
      referenceAt
    }),
    listArticlesWithFilters(db, user.id, {
      limit: queueConfig.limit + 1,
      offset: 0,
      selectedScores: [...SCORE_VALUES],
      selectedReactions: [...REACTION_VALUES],
      readFilter: 'unread',
      sort: 'score_desc',
      selectedTagIds: [],
      minPublishedAt: referenceAt - 7 * DAY_MS
    })
  ]);

  const hero = topUnread.articles.length > 0 ? topUnread.articles[0] : null;
  const upNext = topUnread.articles.slice(1, queueConfig.limit + 1);

  const newToday = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM articles
     WHERE fetched_at >= ?`,
    [referenceAt - DAY_MS]
  );

  const highFit = await dbGet<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM articles a
     WHERE COALESCE(
       (SELECT is_read FROM article_read_state WHERE article_id = a.id AND user_id = ? LIMIT 1), 0
     ) = 0
     AND (SELECT score FROM article_scores WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) >= ?`,
    [user.id, queueConfig.scoreCutoff]
  );

  return json({
    hero,
    upNext,
    stats: {
      unreadTotal: momentum.unreadTotal ?? 0,
      newToday: Number(newToday?.count ?? 0),
      newLast24h: Number(newToday?.count ?? 0),
      highFitUnread: Number(highFit?.count ?? 0)
    },
    newsBrief
  });
};
