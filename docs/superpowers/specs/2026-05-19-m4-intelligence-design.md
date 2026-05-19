# M4 — Intelligence: cursor, dedup, read-state surface (Design)

**Date:** 2026-05-19
**Milestone:** M4 of the 6-month roadmap (Phase 2 — Intelligence)
**Roadmap reference:** `docs/superpowers/specs/2026-05-15-roadmap-design.md` → Phase 2 → M4
**Operator:** Single user
**Outcome:** *"I can ask what changed since yesterday, with the same story from 4 sources collapsed into one."*

---

## 1. Goals & non-goals

### Goal

`get_recent` becomes intelligent in two ways:

1. **`since_last_call` cursor mode** — ask "what's new since last call" without tracking timestamps client-side. Server stores a per-user, per-tool cursor in a new `mcp_cursors` table.
2. **Story-level dedup via URL canonicalization** — articles whose canonical URLs normalize to the same value collapse to one result; siblings appear in `also_seen_in: [{ feed_id, feed_title }]`.

Plus a minimal read-state surface:

3. Every `get_recent` result includes `is_read: boolean`.
4. `unread_only` filter param.
5. `get_article` implicitly UPSERTs `article_read_state.is_read = 1` (you fetched it; presumably you've engaged).

### Non-goals

- **No title or content similarity matching for dedup.** URL canonicalization only. Misses Substack-reposted-from-RSS cases with different URLs — accepted in exchange for zero false-positive risk.
- **No explicit `mark_as_read` / `mark_as_unread` MCP tools.** Those belong to M5 (write tools).
- **No multi-tool cursor system today.** Schema supports per-tool cursors; M4 only writes the `get_recent` key.
- **No retroactive collapse of historical responses.** Each `get_recent` call clusters fresh; no stored cluster state per call.
- **No `search_articles` dedup shape change.** Full-text search stays flat — matching articles, not clusters. `is_read` is exposed there.
- **No web admin UI changes.** Pure MCP surface.
- **No reading-position resume (`read_position_percent`) MCP exposure.** UI-only field.
- **No `time_spent_ms_total` MCP exposure.** Signal for future ranking, not current view.
- **No "best of" primary selection.** First article ingested with a given canonical_url_normalized wins; future articles join `also_seen_in`.

---

## 2. Components & data flow

Four pieces.

### A. Migration `0030_intelligence.sql`

```sql
-- M4 — Intelligence: canonical-url dedup column + per-user MCP cursors.

ALTER TABLE articles ADD COLUMN canonical_url_normalized TEXT;
CREATE INDEX idx_articles_canonical_normalized
  ON articles (canonical_url_normalized)
  WHERE canonical_url_normalized IS NOT NULL;

-- Backfill existing rows with a SQL approximation of canonicalization.
-- This is intentionally less aggressive than the JS helper (no utm stripping,
-- no query reordering); the goal is "good enough for dedup at personal scale."
-- New articles get the full helper at INSERT time.
UPDATE articles
SET canonical_url_normalized = LOWER(
  CASE
    WHEN canonical_url LIKE '%/' AND canonical_url != '/' THEN SUBSTR(canonical_url, 1, LENGTH(canonical_url) - 1)
    ELSE canonical_url
  END
)
WHERE canonical_url_normalized IS NULL;

-- Per-user MCP cursors keyed by (user_id, tool_name) so future tools can
-- add their own cursors without schema migrations.
CREATE TABLE mcp_cursors (
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  cursor_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool_name),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
```

### B. Pure URL canonicalizer — `src/lib/canonical-url.ts`

```ts
export function canonicalizeUrl(rawUrl: string): string;
```

Deterministic transform pipeline:
1. Trim whitespace.
2. Parse via `new URL(rawUrl)`. If parsing throws (e.g., `mid:<message-id>`), return `rawUrl.toLowerCase().replace(/\/+$/, '')` — the simple fallback.
3. Lowercase host. Drop leading `www.`.
4. Normalize scheme: `http:` → `https:`.
5. Strip tracking query params: `utm_*` (prefix match), `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `s`, `igshid`, `_ga`.
6. Sort remaining query params alphabetically (order-independence).
7. Drop fragment (`#anchor`).
8. Drop trailing slash from path (unless path is exactly `/`).
9. Return the rebuilt URL.

Pure function. Tested against ~10 fixture cases including idempotence.

### C. Wire into ingestion sites (5 callers, one-line each)

Every `INSERT INTO articles` callsite computes `canonical_url_normalized` and includes it in the bind list:
- `src/cron/poll-feeds.ts` (RSS/Substack/Mastodon/HN)
- `src/cron/poll-reddit.ts`
- `src/cron/poll-youtube.ts`
- `src/cron/poll-bluesky.ts`
- `src/email.ts` (newsletter handler)

Each one:

```ts
import { canonicalizeUrl } from '../lib/canonical-url';
// ...
const canonicalUrlNorm = canonicalizeUrl(canonicalUrl);
// Add `canonical_url_normalized` to the INSERT column list and `canonicalUrlNorm` to the bind values.
```

### D. `get_recent` rewrite — `src/mcp/tools.ts`

**New input-schema params:**
- `since_last_call?: boolean` (default false) — server-side cursor mode.
- `unread_only?: boolean` (default false) — filter to articles with no read-state row OR `is_read = 0`.

Existing `since`, `limit`, `feed_ids` remain.

**Validation:** if both `since` and `since_last_call=true` are supplied, return an error response: `"Use either 'since' (client-tracked timestamp) or 'since_last_call' (server cursor), not both."`

**Cursor handling:**
- On `since_last_call=true`: read `mcp_cursors` WHERE `user_id=? AND tool_name='get_recent'`. If a row exists, use its `cursor_at` as the lower bound. If not (first call), default to `now - 7*24*3600*1000` (last 7 days).
- After the query (success path), UPSERT `mcp_cursors` SET `cursor_at = Date.now()`.

**Cluster query (sketch):**

```sql
WITH cluster_keys AS (
  SELECT
    canonical_url_normalized,
    MIN(id) AS primary_article_id
  FROM articles a
  WHERE a.published_at > ?           -- since / since_last_call lower bound
    AND a.quarantined_at IS NULL
    AND [subscribed-feeds filter]
    AND [feed_ids filter if provided]
  GROUP BY canonical_url_normalized
)
SELECT
  a.id, a.title, a.canonical_url, a.published_at, a.excerpt, a.author,
  a.source_type, a.image_url, a.word_count,
  ars.is_read AS read_flag
FROM cluster_keys ck
JOIN articles a ON a.id = ck.primary_article_id
LEFT JOIN article_read_state ars
  ON ars.user_id = ? AND ars.article_id = a.id
WHERE [unread_only filter: ars.is_read IS NULL OR ars.is_read = 0]
ORDER BY a.published_at DESC
LIMIT ?;
```

**`also_seen_in` resolution** (second batch query for clustered articles only):

```sql
-- For each primary article in the result, find sibling articles that share
-- canonical_url_normalized, then fetch their source feeds.
SELECT
  primary.id AS primary_id,
  src.feed_id,
  f.title AS feed_title
FROM articles primary
JOIN articles sibling
  ON sibling.canonical_url_normalized = primary.canonical_url_normalized
  AND sibling.id != primary.id
JOIN article_sources src ON src.article_id = sibling.id
JOIN feeds f ON f.id = src.feed_id
WHERE primary.id IN (?, ?, ?, ...)
GROUP BY primary.id, src.feed_id;
```

Grouped client-side: `Map<primary_id, [{feed_id, feed_title}]>`. Empty array when there are no siblings.

**Result item shape:**

```ts
{
  id, title, canonical_url, published_at, excerpt, author,
  source_type, image_url, word_count,
  is_read: boolean,                                         // ars.is_read === 1
  also_seen_in: Array<{ feed_id: string, feed_title: string }>,
}
```

**Tool description** updated to document `since_last_call` and `unread_only` params and the `is_read` / `also_seen_in` result fields.

### E. `get_article` implicit read mark

After fetching the article body and before returning, UPSERT the read state:

```sql
INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
VALUES (?, ?, 1, ?)
ON CONFLICT(user_id, article_id) DO UPDATE SET
  is_read = 1,
  updated_at = excluded.updated_at;
```

The response shape is unchanged. The write is best-effort — failure logs and doesn't block the response.

### Data flow (end-to-end)

```
1. Article ingested by any of 5 callers
   → canonicalizeUrl(canonical_url) → canonical_url_normalized stored

2. LLM calls get_recent({ since_last_call: true, unread_only: true })
   → server reads mcp_cursors → lower bound
   → cluster_keys CTE groups by canonical_url_normalized
   → LEFT JOIN article_read_state → is_read
   → unread filter
   → secondary batch query → also_seen_in
   → UPSERT cursor_at = now
   → return clustered, unread, since-last-call results

3. LLM calls get_article({ article_id: 'X' })
   → fetch + UPSERT article_read_state SET is_read = 1
   → return article body unchanged

4. Next get_recent({ unread_only: true }) excludes article X.
```

---

## 3. Risks & known unknowns

- **Backfill of existing articles.** Migration UPDATEs every row with a SQL-approximated canonicalization (lowercase + trailing-slash). Old articles with `?utm_source=...` won't cluster with newer post-M4 articles that had the utm stripped by the JS helper. **Accept:** good enough at personal scale; future one-shot script can re-canonicalize if needed.
- **Cursor drift on errors.** If `get_recent` throws after the SELECT but before the cursor UPDATE, the next call sees the old cursor and re-returns the same articles. **Accept:** duplicate results are harmless; advance only on success.
- **Frequent-polling cursor exhaustion.** `since_last_call=true` called every few seconds advances the cursor with each call. Documented as expected behavior — use `since: <epoch_ms>` for absolute windows when debugging.
- **First-call default of 7 days.** Chosen to keep the first `since_last_call=true` useful but bounded. A daily-brief workflow won't notice; an "I haven't checked in a month" workflow gets a useful slice rather than the full backlog. Tunable later.
- **Primary article stability.** First-ingested wins. If a later article has a better title/excerpt, that quality is lost (sibling is in `also_seen_in` but its content isn't surfaced). **Accept:** deterministic and good enough; cluster-quality work is M4.5.
- **`mid:` URLs from email.** `new URL('mid:foo')` throws. The fallback (lowercase + trailing-slash) handles it cleanly. Email articles dedup by Message-Id naturally (globally unique); they won't false-cluster with HTTP articles.
- **`is_read` LEFT JOIN behavior.** Articles the user has never touched have no `article_read_state` row → `is_read` is NULL → we resolve to `false`. Correct for the unread filter.

---

## 4. Testing

- **`src/lib/__tests__/canonical-url.test.ts`** (new) — pure-function tests:
  - `utm` stripping (`?utm_source=x&utm_medium=y` → no query)
  - `fbclid` / `gclid` / `mc_cid` stripping
  - `www.` host drop
  - `http://` → `https://` normalize
  - Fragment drop
  - Trailing slash drop (except root)
  - Query param order-independence (same output for `?b=2&a=1` and `?a=1&b=2`)
  - `mid:abc-123@example.com` fallback (no throw)
  - Idempotence (`f(f(x)) === f(x)`)
  - Empty string fallback
- **`src/mcp/__tests__/tools.test.ts`** (new) — pure-helper tests for any logic extracted from the orchestrator (e.g., `buildAlsoSeenInMap(rows): Map<string, Array<{feed_id,feed_title}>>`). The orchestrator itself is exercised end-to-end via the same pattern as M1-M3.
- **No new fixture tests for the ingestion sites** — these are mechanical one-line changes. Existing tests verify pollers still run; manual verification confirms `canonical_url_normalized` is populated.

---

## 5. File structure

**Create:**
- `migrations/0030_intelligence.sql` — schema additions + backfill.
- `src/lib/canonical-url.ts` — `canonicalizeUrl` helper.
- `src/lib/__tests__/canonical-url.test.ts` — fixture-driven tests.
- `src/mcp/__tests__/tools.test.ts` — pure-helper tests for whatever the orchestrator extracts (e.g., `buildAlsoSeenInMap`).

**Modify:**
- `src/cron/poll-feeds.ts` — call `canonicalizeUrl`, add column to INSERT.
- `src/cron/poll-reddit.ts` — same.
- `src/cron/poll-youtube.ts` — same.
- `src/cron/poll-bluesky.ts` — same.
- `src/email.ts` — same.
- `src/mcp/tools.ts` — `get_recent` rewrite (cluster CTE, also_seen_in batch, is_read, since_last_call cursor); `get_article` UPSERT read state; updated tool descriptions.
- `CLAUDE.md` — record `mcp_cursors` table, `canonical_url_normalized` column, new `get_recent` params + result shape, new `is_read` semantic.

---

## 6. Exit criteria

1. Migration `0030` applies cleanly via `npm run migrate:local`; existing articles have `canonical_url_normalized` populated.
2. New article INSERTs across all 5 sources include the normalized URL.
3. Two articles ingested with `canonical_url` differing only in `utm_*` params land with the same `canonical_url_normalized`.
4. `get_recent({ since_last_call: true })` on a first call defaults to 7 days; subsequent calls only return articles published after the previous call.
5. `get_recent({ unread_only: true })` excludes articles where `article_read_state.is_read = 1`.
6. A `get_recent` result item carries `is_read: boolean` and `also_seen_in: Array<{feed_id, feed_title}>`.
7. Calling `get_article(id)` once causes a subsequent `get_recent({ unread_only: true })` to exclude that article.
8. `get_article` failures (article missing, etc.) don't write a read-state row.
9. `get_recent({ since: X, since_last_call: true })` returns an error explaining the two are mutually exclusive.
10. A `mid:`-URL email article doesn't throw during `canonicalizeUrl` and doesn't false-cluster with HTTP articles.

---

## 7. Sequencing (informs the plan)

1. Migration `0030` first.
2. `canonical-url.ts` with fixture tests.
3. Wire into all 5 ingestion sites (mechanical pass).
4. `get_recent` rewrite (cluster CTE + also_seen_in + is_read + since_last_call).
5. `get_article` implicit read mark.
6. CLAUDE.md docs.
7. End-to-end manual verification.

---

## 8. Open follow-ups (not in M4)

- Title/content similarity dedup (M4.5 or later — when URL-only proves insufficient).
- "Best of" primary selection in clusters (longest content, highest extraction_quality, etc.).
- Explicit `mark_as_read` / `mark_as_unread` MCP tools (M5).
- `read_position_percent` MCP surface (UI-only field; revisit if a chat-side use emerges).
- `time_spent_ms_total` exposure as a ranking signal.
- Per-tool cursors for `search_articles` or `get_article` if "since I last looked at this article" semantics ever matter.
- Cursor admin/reset endpoints.
- One-shot re-canonicalization script for backfilled-with-SQL-approximation old rows.
- `also_seen_in` in `search_articles` if cluster context proves useful in FTS results.
