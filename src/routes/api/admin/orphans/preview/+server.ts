import { apiOk } from '$lib/server/api';
import {
  countOrphanArticles,
  listOrphanArticleIds,
  DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT,
  ORPHAN_PREVIEW_SAMPLE_SIZE
} from '$lib/server/orphan-cleanup';

export const GET = async (event) => {
  const db = event.platform.env.DB;
  const [orphanCount, sampleArticleIds] = await Promise.all([
    countOrphanArticles(db),
    listOrphanArticleIds(db, ORPHAN_PREVIEW_SAMPLE_SIZE)
  ]);

  return apiOk(event, {
    orphan_count: orphanCount,
    sample_article_ids: sampleArticleIds,
    suggested_batch_size: DEFAULT_MANUAL_ORPHAN_CLEANUP_LIMIT
  });
};

