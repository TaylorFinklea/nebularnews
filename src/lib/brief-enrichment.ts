import type { D1Database } from '@cloudflare/workers-types';
import { dbAll } from '../db/helpers';

/// One AI-emitted bullet before enrichment. Just text + the article ids
/// the model picked as supporting sources.
export type RawBullet = {
  text?: string;
  source_article_ids?: string[];
};

/// Per-source metadata persisted in `bullets_json` and read by the iOS
/// brief card. Optional fields are nullable when missing so older
/// stored briefs still decode.
export type EnrichedSource = {
  article_id: string;
  title: string | null;
  canonical_url: string | null;
  source_name: string | null;
  score: number | null;
  tags: string[];
};

export type EnrichedBullet = {
  text: string;
  sources: EnrichedSource[];
};

/// Candidate shape both `brief.ts` and `scheduled-briefs.ts` already
/// build before invoking the model. We accept any object that exposes
/// `id`, `title`, optional `sourceName`, and optional score field.
export type EnrichmentCandidate = {
  id: string;
  title: string;
  sourceName?: string | null;
  effectiveScore?: number | null;
};

/// Loads the tag names attached to each article in `articleIds`. One
/// query, capped by the call site (D1 has a ~100 SQL variable limit;
/// MAX_ARTICLES is 20 in brief.ts and similar in cron, so we're safe).
export async function loadTagsByArticle(
  db: D1Database,
  articleIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (articleIds.length === 0) return result;

  const placeholders = articleIds.map(() => '?').join(',');
  const rows = await dbAll<{ article_id: string; name: string }>(
    db,
    `SELECT at.article_id, t.name
       FROM article_tags at
       JOIN tags t ON t.id = at.tag_id
      WHERE at.article_id IN (${placeholders})
      ORDER BY at.article_id, t.name`,
    articleIds,
  );
  for (const row of rows) {
    const list = result.get(row.article_id) ?? [];
    list.push(row.name);
    result.set(row.article_id, list);
  }
  return result;
}

/// Turns the AI's raw bullets into the persisted enriched shape that
/// the iOS Today card consumes. Pass the candidates that the AI was
/// given so we can hydrate source_name / score from data the route
/// already loaded; tags require one extra batched query.
export async function enrichBullets(
  db: D1Database,
  rawBullets: RawBullet[],
  candidates: EnrichmentCandidate[],
): Promise<EnrichedBullet[]> {
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const tagsByArticle = await loadTagsByArticle(db, candidates.map((c) => c.id));

  return rawBullets.map((b) => {
    const sourceIds = b.source_article_ids ?? [];
    const sources: EnrichedSource[] = sourceIds
      .map((id) => candidateMap.get(id))
      .filter((c): c is EnrichmentCandidate => Boolean(c))
      .map((c) => ({
        article_id: c.id,
        title: c.title,
        canonical_url: null,
        source_name: c.sourceName ?? null,
        score: c.effectiveScore ?? null,
        tags: tagsByArticle.get(c.id) ?? [],
      }));
    return { text: b.text ?? '', sources };
  });
}
