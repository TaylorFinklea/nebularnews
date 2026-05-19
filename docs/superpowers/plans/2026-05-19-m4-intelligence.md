# M4 — Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `get_recent` intelligent — server-side `since_last_call` cursor, URL-canonicalization-based story clustering with `also_seen_in` provenance, and a minimal read-state surface (`is_read` in results, `unread_only` filter, `get_article` implicit mark).

**Architecture:** A new `src/lib/canonical-url.ts` pure helper normalizes URLs (strip utm, lowercase host, sort query params, etc.). Every `INSERT INTO articles` site computes a `canonical_url_normalized` column added by migration 0030. `get_recent` is rewritten with a CTE that GROUPs by the normalized URL and LEFT JOINs `article_read_state`; a second batch query resolves `also_seen_in` for each cluster. A `mcp_cursors` table holds per-user, per-tool timestamps for the `since_last_call` semantic. `get_article` UPSERTs `article_read_state.is_read = 1` as a best-effort side effect.

**Tech Stack:** Cloudflare Workers, Hono, D1 (raw SQL), Vitest. No new npm dependencies. Native `URL` constructor + Web URLSearchParams for canonicalization.

---

## File Structure

**Create**
- `migrations/0030_intelligence.sql` — `articles.canonical_url_normalized` column + backfill + `mcp_cursors` table.
- `src/lib/canonical-url.ts` — `canonicalizeUrl(rawUrl): string` pure helper.
- `src/lib/__tests__/canonical-url.test.ts` — fixture-driven tests.
- `src/mcp/__tests__/tools.test.ts` — pure-helper tests for `buildAlsoSeenInMap`.

**Modify**
- `src/cron/poll-feeds.ts` — compute + bind `canonical_url_normalized` on INSERT.
- `src/cron/poll-reddit.ts` — same.
- `src/cron/poll-youtube.ts` — same.
- `src/cron/poll-bluesky.ts` — same.
- `src/email.ts` — same in `handleEmail`.
- `src/mcp/tools.ts` — rewrite `getRecent` with cluster CTE, also_seen_in, is_read, since_last_call cursor; extend `addFeed`/etc. unaffected; rewrite `getArticle` to UPSERT read state; update tool descriptions; export `buildAlsoSeenInMap` for unit tests.
- `CLAUDE.md` — record `mcp_cursors` table, `canonical_url_normalized` column, new `get_recent` params + result shape, `is_read` semantic.

Each file has one responsibility. The `src/lib/canonical-url.ts` ↔ `src/mcp/tools.ts` split keeps URL normalization independently testable.

---

## Sequencing

1. Migration first — schema before code references new columns.
2. Pure canonicalizer with fixture tests — no dependencies.
3. Wire into 5 ingestion sites (mechanical batch).
4. `get_recent` rewrite — cluster + also_seen_in + is_read + cursor.
5. `get_article` implicit read mark.
6. CLAUDE.md docs.
7. Manual end-to-end verification.

---

## Task 1: Migration 0030 — canonical_url_normalized + mcp_cursors

**Files:**
- Create: `migrations/0030_intelligence.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Migration 0030 — Intelligence: URL-canonicalization dedup + MCP cursors
--
-- M4 of the 6-month roadmap. Adds `articles.canonical_url_normalized` so the
-- LLM's view of articles can collapse "same story from 4 sources" into one
-- entry with `also_seen_in` provenance. Also adds `mcp_cursors` so
-- `get_recent({ since_last_call: true })` works without client-tracked
-- timestamps.
--
-- The backfill UPDATE uses a SQL-approximated canonicalization (lowercase +
-- trailing-slash strip) rather than the full JS helper. Old articles with
-- ?utm_source=... won't cluster with newer post-M4 articles that had the utm
-- stripped at INSERT time. Acceptable at personal scale; a future one-shot
-- script can re-canonicalize if needed.

ALTER TABLE articles ADD COLUMN canonical_url_normalized TEXT;

CREATE INDEX idx_articles_canonical_normalized
  ON articles (canonical_url_normalized)
  WHERE canonical_url_normalized IS NOT NULL;

UPDATE articles
SET canonical_url_normalized = LOWER(
  CASE
    WHEN canonical_url LIKE '%/' AND canonical_url != '/' THEN SUBSTR(canonical_url, 1, LENGTH(canonical_url) - 1)
    ELSE canonical_url
  END
)
WHERE canonical_url_normalized IS NULL;

CREATE TABLE mcp_cursors (
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  cursor_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool_name),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: applies `0030_intelligence.sql` without error.

- [ ] **Step 3: Verify the new column**

Run: `npx wrangler d1 execute DB --local --command "PRAGMA table_info(articles);" 2>&1 | grep canonical_url_normalized`
Expected: a row showing the new column (TEXT, nullable).

- [ ] **Step 4: Verify the backfill ran**

Run: `npx wrangler d1 execute DB --local --command "SELECT COUNT(*) FROM articles WHERE canonical_url_normalized IS NULL;"`
Expected: `0` (every existing row got a value). If your local DB has zero articles, that's also fine.

- [ ] **Step 5: Verify the cursors table**

Run: `npx wrangler d1 execute DB --local --command "PRAGMA table_info(mcp_cursors);"`
Expected: three columns: `user_id`, `tool_name`, `cursor_at` — all NOT NULL.

- [ ] **Step 6: Commit**

```bash
git add migrations/0030_intelligence.sql
git commit -m "feat(db): migration 0030 — canonical_url_normalized + mcp_cursors for M4"
```

Do NOT push.

---

## Task 2: Pure URL canonicalizer + fixture tests

`canonicalizeUrl(rawUrl)` is the deterministic transform that turns two equivalent URLs into the same string. Pure function, fully tested.

**Files:**
- Create: `src/lib/__tests__/canonical-url.test.ts`
- Create: `src/lib/canonical-url.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/canonical-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../canonical-url';

describe('canonicalizeUrl', () => {
  it('strips utm_* tracking params', () => {
    expect(canonicalizeUrl('https://example.com/post?utm_source=newsletter&utm_medium=email&a=keep'))
      .toBe('https://example.com/post?a=keep');
  });

  it('strips utm_* even when alone', () => {
    expect(canonicalizeUrl('https://example.com/post?utm_source=x'))
      .toBe('https://example.com/post');
  });

  it('strips fbclid, gclid, mc_cid, mc_eid, ref, ref_src, s, igshid, _ga', () => {
    expect(canonicalizeUrl('https://example.com/post?fbclid=abc&gclid=def&ref=twitter&s=09'))
      .toBe('https://example.com/post');
  });

  it('drops www. host prefix', () => {
    expect(canonicalizeUrl('https://www.example.com/post'))
      .toBe('https://example.com/post');
  });

  it('normalizes http to https', () => {
    expect(canonicalizeUrl('http://example.com/post'))
      .toBe('https://example.com/post');
  });

  it('drops URL fragment', () => {
    expect(canonicalizeUrl('https://example.com/post#section-2'))
      .toBe('https://example.com/post');
  });

  it('drops trailing slash from path (but not root)', () => {
    expect(canonicalizeUrl('https://example.com/post/'))
      .toBe('https://example.com/post');
    expect(canonicalizeUrl('https://example.com/'))
      .toBe('https://example.com/');
  });

  it('sorts query params alphabetically for order-independence', () => {
    expect(canonicalizeUrl('https://example.com/post?b=2&a=1'))
      .toBe(canonicalizeUrl('https://example.com/post?a=1&b=2'));
  });

  it('returns a low-effort fallback for non-URL inputs like mid:<id>', () => {
    // postal-mime canonical URLs for emails are "mid:<message-id>" — not
    // parseable by new URL(). Helper must not throw; lowercase + trailing
    // slash trim is sufficient since Message-Ids are already globally unique.
    expect(canonicalizeUrl('mid:Stratechery-Test-001@email.stratechery.com'))
      .toBe('mid:stratechery-test-001@email.stratechery.com');
  });

  it('is idempotent', () => {
    const inputs = [
      'https://www.example.com/post/?utm_source=x&b=2&a=1',
      'http://EXAMPLE.com/post#anchor',
      'mid:foo@bar',
      'https://example.com/',
    ];
    for (const input of inputs) {
      const once = canonicalizeUrl(input);
      const twice = canonicalizeUrl(once);
      expect(twice).toBe(once);
    }
  });

  it('handles empty string', () => {
    expect(canonicalizeUrl('')).toBe('');
  });

  it('clusters two equivalent URLs to the same value', () => {
    const a = canonicalizeUrl('https://www.example.com/breaking-news?utm_source=feed1');
    const b = canonicalizeUrl('http://example.com/breaking-news/?utm_medium=email#top');
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/lib/__tests__/canonical-url.test.ts`
Expected: 11 tests fail — module not found.

- [ ] **Step 3: Implement canonicalizeUrl**

Create `src/lib/canonical-url.ts`:

```ts
// Deterministic URL canonicalization for story-level dedup.
//
// Two URLs that point to the same story (modulo tracking params, www
// prefix, http vs https, query order, fragment, trailing slash) canonicalize
// to the same string. Used at INSERT time on every article so the LLM's
// `get_recent` view can collapse "same story from 4 sources" into one entry.
//
// Conservative on purpose: URL transforms only, no title/content similarity.
// Misses cases like "Substack republishes RSS post with a different URL,"
// which is acceptable in exchange for zero false-positive risk.

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 's', 'igshid', '_ga',
]);

function lowFallback(input: string): string {
  // For non-URL canonical strings like `mid:<message-id>` from email
  // articles. Lowercase + trailing-slash trim is enough — Message-Ids are
  // already globally unique.
  return input.toLowerCase().replace(/\/+$/, '');
}

export function canonicalizeUrl(rawUrl: string): string {
  const input = (rawUrl ?? '').trim();
  if (!input) return '';

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return lowFallback(input);
  }

  // Lowercase host, drop leading "www."
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  url.hostname = host;

  // Normalize scheme.
  if (url.protocol === 'http:') url.protocol = 'https:';

  // Strip tracking params and sort the remainder alphabetically.
  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('utm_')) continue;
    if (TRACKING_PARAMS.has(key)) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  // Rebuild search string deterministically.
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);

  // Drop fragment.
  url.hash = '';

  // Drop trailing slash from path (except when path is just "/").
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/canonical-url.test.ts`
Expected: 11 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical-url.ts src/lib/__tests__/canonical-url.test.ts
git commit -m "feat(canonical-url): URL normalization helper with fixture tests"
```

Do NOT push.

---

## Task 3: Wire canonicalizeUrl into 5 ingestion sites

Mechanical batch: each `INSERT INTO articles` callsite imports `canonicalizeUrl`, computes the normalized value, and adds `canonical_url_normalized` to its column + bind lists.

**Files:**
- Modify: `src/cron/poll-feeds.ts`
- Modify: `src/cron/poll-reddit.ts`
- Modify: `src/cron/poll-youtube.ts`
- Modify: `src/cron/poll-bluesky.ts`
- Modify: `src/email.ts`

For each file, the change pattern is identical:

(a) Add the import alongside existing lib imports:

```ts
import { canonicalizeUrl } from '../lib/canonical-url';
```

(For `src/email.ts`, the path is `./lib/canonical-url`.)

(b) Inside the loop that INSERTs an article, just before the INSERT, compute the normalized URL from whatever variable holds the canonical URL (variable name varies by file: `canonicalUrl`, `canonical_url`, `post.canonicalUrl`, etc.):

```ts
const canonicalUrlNorm = canonicalizeUrl(canonicalUrl); // or whatever the local variable is
```

(c) In the `INSERT INTO articles (...)` column list, add `canonical_url_normalized` at the end. In the `VALUES (?, ?, ...)` placeholder list, add one more `?`. In the bind-args array, add `canonicalUrlNorm` at the corresponding position.

- [ ] **Step 1: Read every site to confirm the local variable name for the canonical URL**

For each file, identify the variable. Confirm before editing:
- `src/cron/poll-feeds.ts`: `canonicalUrl` (the `item.url`)
- `src/cron/poll-reddit.ts`: `canonicalUrl` (`https://www.reddit.com${post.permalink}`)
- `src/cron/poll-youtube.ts`: `canonicalUrl` (`item.url`)
- `src/cron/poll-bluesky.ts`: `post.canonicalUrl`
- `src/email.ts`: `canonicalUrl` (local variable holding `mid:<message-id>` or hash fallback)

- [ ] **Step 2: Edit `src/cron/poll-feeds.ts`**

Add the import at the top. In the new-article INSERT (search for `INSERT INTO articles`), add `canonical_url_normalized` after the last existing column name. Add `canonicalizeUrl(canonicalUrl)` to the bind args. (No need to introduce a separate variable — inline the call.)

Both INSERTs in this file (the new-article INSERT in the loop body) need the same column. There may be only one — verify by reading.

- [ ] **Step 3: Edit `src/cron/poll-reddit.ts`**

Same pattern. The INSERT is in the for-loop over `children`.

- [ ] **Step 4: Edit `src/cron/poll-youtube.ts`**

Same pattern. The INSERT is in the for-loop over feed items.

- [ ] **Step 5: Edit `src/cron/poll-bluesky.ts`**

Same pattern. The INSERT is in the for-loop over parsed posts. Variable is `post.canonicalUrl`.

- [ ] **Step 6: Edit `src/email.ts`**

Same pattern. The INSERT is in `handleEmail` after `emailCanonicalUrl(...)` resolves. Variable is `canonicalUrl` (or whatever the local result of that call is bound to — read the file to confirm).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Run all tests**

Run: `npm run test`
Expected: all tests still pass. No test directly verifies the new column, but no test should regress either.

- [ ] **Step 9: Sanity-check via a local INSERT**

Optional but valuable: with `wrangler dev` running, manually trigger one of the pollers (e.g., `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"`) and then query:

```bash
npx wrangler d1 execute DB --local --command "SELECT id, canonical_url, canonical_url_normalized FROM articles ORDER BY fetched_at DESC LIMIT 3;"
```

Expected: the most-recent rows have a non-NULL `canonical_url_normalized` that looks correctly canonicalized.

- [ ] **Step 10: Commit**

```bash
git add src/cron/poll-feeds.ts src/cron/poll-reddit.ts src/cron/poll-youtube.ts src/cron/poll-bluesky.ts src/email.ts
git commit -m "feat(ingestion): populate canonical_url_normalized on all article INSERTs"
```

Do NOT push.

---

## Task 4: `get_recent` rewrite — cluster + also_seen_in + is_read + since_last_call

This is the heaviest task. Rewrite `getRecent` in `src/mcp/tools.ts` with the cluster CTE, second batch query for `also_seen_in`, LEFT JOIN to `article_read_state` for `is_read`, and `since_last_call` cursor handling. Extract `buildAlsoSeenInMap` as an exported pure helper for unit testing.

**Files:**
- Modify: `src/mcp/tools.ts`
- Create: `src/mcp/__tests__/tools.test.ts`

- [ ] **Step 1: Write failing tests for the pure helper**

Create `src/mcp/__tests__/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAlsoSeenInMap } from '../tools';

describe('buildAlsoSeenInMap', () => {
  it('groups rows by primary_id', () => {
    const rows = [
      { primary_id: 'a1', feed_id: 'f1', feed_title: 'Feed 1' },
      { primary_id: 'a1', feed_id: 'f2', feed_title: 'Feed 2' },
      { primary_id: 'a2', feed_id: 'f3', feed_title: 'Feed 3' },
    ];
    const map = buildAlsoSeenInMap(rows);
    expect(map.get('a1')).toEqual([
      { feed_id: 'f1', feed_title: 'Feed 1' },
      { feed_id: 'f2', feed_title: 'Feed 2' },
    ]);
    expect(map.get('a2')).toEqual([
      { feed_id: 'f3', feed_title: 'Feed 3' },
    ]);
  });

  it('returns empty map for empty input', () => {
    expect(buildAlsoSeenInMap([])).toEqual(new Map());
  });

  it('handles a single primary with a single sibling', () => {
    const map = buildAlsoSeenInMap([{ primary_id: 'a1', feed_id: 'f1', feed_title: 'Feed 1' }]);
    expect(map.size).toBe(1);
    expect(map.get('a1')).toEqual([{ feed_id: 'f1', feed_title: 'Feed 1' }]);
  });

  it('preserves row order within a group (DB ordering)', () => {
    const rows = [
      { primary_id: 'a1', feed_id: 'f1', feed_title: 'A' },
      { primary_id: 'a1', feed_id: 'f2', feed_title: 'B' },
      { primary_id: 'a1', feed_id: 'f3', feed_title: 'C' },
    ];
    const map = buildAlsoSeenInMap(rows);
    expect(map.get('a1')!.map((x) => x.feed_title)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/mcp/__tests__/tools.test.ts`
Expected: 4 tests fail — `buildAlsoSeenInMap` not exported.

- [ ] **Step 3: Read the existing `getRecent` to plan the replacement**

Run: `grep -n "getRecent\|function getRecent" src/mcp/tools.ts`
Note the function's location and current shape. The current implementation joins articles, article_sources, and user_feed_subscriptions; it filters by `subscribed feeds`, `published_at > since`, `feed_ids`, paused, and (after M3) `quarantined_at IS NULL`.

- [ ] **Step 4: Replace `getRecent` and add `buildAlsoSeenInMap`**

In `src/mcp/tools.ts`:

(a) Update the `get_recent` tool's `inputSchema` (in the `TOOL_DEFINITIONS` array) to include the new params:

```ts
{
  name: 'get_recent',
  description: 'Get recent articles across the user\'s subscribed feeds, newest first. Articles with the same canonical URL across multiple feeds are collapsed into one item with `also_seen_in` listing the other source feeds. Each item carries an `is_read` flag. Use `since_last_call: true` to ask "what arrived since I last called this tool" without tracking timestamps yourself.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      since: { type: 'number', description: 'Unix epoch ms; only articles published or fetched after this time. Mutually exclusive with since_last_call.' },
      since_last_call: { type: 'boolean', description: 'When true, server uses a per-user cursor: returns only articles published after the previous successful get_recent call. Mutually exclusive with `since`. First call defaults to last 7 days.' },
      unread_only: { type: 'boolean', description: 'When true, exclude articles already marked as read (via get_article).' },
      limit: { type: 'number', description: 'Max results (default 25, max 100)' },
      feed_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict to specific feed ids (default: all subscribed feeds)',
      },
    },
  },
},
```

(b) Add the `buildAlsoSeenInMap` helper at module scope, near the other internal helpers (search for a similar export pattern like `DEFAULT_SCRAPE_MODE`):

```ts
// Pure helper extracted for unit testing. Takes rows of the shape
// { primary_id, feed_id, feed_title } from the also_seen_in batch query
// and groups them by primary article id.
export function buildAlsoSeenInMap(
  rows: Array<{ primary_id: string; feed_id: string; feed_title: string | null }>,
): Map<string, Array<{ feed_id: string; feed_title: string }>> {
  const map = new Map<string, Array<{ feed_id: string; feed_title: string }>>();
  for (const row of rows) {
    if (!map.has(row.primary_id)) map.set(row.primary_id, []);
    map.get(row.primary_id)!.push({
      feed_id: row.feed_id,
      feed_title: row.feed_title ?? '',
    });
  }
  return map;
}
```

(c) Replace the existing `getRecent` function body with:

```ts
async function getRecent(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sinceLastCall = args.since_last_call === true;
  const sinceParam = typeof args.since === 'number' ? args.since : null;
  const unreadOnly = args.unread_only === true;
  const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 100);
  const feedIdsRaw = Array.isArray(args.feed_ids)
    ? (args.feed_ids as unknown[]).filter((s): s is string => typeof s === 'string')
    : null;
  const feedIds = feedIdsRaw && feedIdsRaw.length > 0 ? feedIdsRaw : null;

  if (sinceLastCall && sinceParam !== null) {
    return {
      content: [{
        type: 'text',
        text: "Use either 'since' (client-tracked timestamp) or 'since_last_call' (server cursor), not both.",
      }],
    };
  }

  // Resolve the time lower bound.
  let since: number;
  if (sinceLastCall) {
    const cursor = await dbGet<{ cursor_at: number }>(
      ctx.db,
      `SELECT cursor_at FROM mcp_cursors WHERE user_id = ? AND tool_name = 'get_recent'`,
      [ctx.userId],
    );
    since = cursor?.cursor_at ?? (Date.now() - 7 * 24 * 60 * 60 * 1000);
  } else if (sinceParam !== null) {
    since = sinceParam;
  } else {
    since = 0;
  }

  // Cluster CTE: one primary article per canonical_url_normalized within the
  // user's subscribed-non-paused feed scope. Falls back to `id` grouping for
  // legacy articles whose canonical_url_normalized is null.
  const feedIdPlaceholders = feedIds ? feedIds.map(() => '?').join(',') : '';
  const feedIdClause = feedIds ? `AND src.feed_id IN (${feedIdPlaceholders})` : '';
  const unreadClause = unreadOnly ? `AND (ars.is_read IS NULL OR ars.is_read = 0)` : '';

  const articleRows = await dbAll<{
    id: string;
    title: string;
    canonical_url: string;
    canonical_url_normalized: string | null;
    published_at: number;
    excerpt: string | null;
    author: string | null;
    source_type: string;
    image_url: string | null;
    word_count: number;
    is_read: number | null;
  }>(
    ctx.db,
    `WITH cluster_keys AS (
       SELECT
         COALESCE(a.canonical_url_normalized, a.id) AS cluster_key,
         MIN(a.id) AS primary_article_id
       FROM articles a
       JOIN article_sources src ON src.article_id = a.id
       JOIN user_feed_subscriptions ufs
         ON ufs.feed_id = src.feed_id AND ufs.user_id = ?
       WHERE a.published_at > ?
         AND a.quarantined_at IS NULL
         AND COALESCE(ufs.paused, 0) = 0
         ${feedIdClause}
       GROUP BY cluster_key
     )
     SELECT
       a.id, a.title, a.canonical_url, a.canonical_url_normalized,
       a.published_at, a.excerpt, a.author, a.source_type,
       a.image_url, a.word_count,
       ars.is_read AS is_read
     FROM cluster_keys ck
     JOIN articles a ON a.id = ck.primary_article_id
     LEFT JOIN article_read_state ars
       ON ars.user_id = ? AND ars.article_id = a.id
     WHERE 1=1 ${unreadClause}
     ORDER BY a.published_at DESC
     LIMIT ?`,
    [ctx.userId, since, ...(feedIds ?? []), ctx.userId, limit],
  );

  // Batch query for also_seen_in: for each primary article that has a
  // canonical_url_normalized, find sibling articles sharing that key and
  // their source feeds.
  const clusteredIds = articleRows
    .filter((r) => r.canonical_url_normalized !== null)
    .map((r) => r.id);

  let alsoSeenInMap = new Map<string, Array<{ feed_id: string; feed_title: string }>>();
  if (clusteredIds.length > 0) {
    const placeholders = clusteredIds.map(() => '?').join(',');
    const siblingRows = await dbAll<{ primary_id: string; feed_id: string; feed_title: string | null }>(
      ctx.db,
      `SELECT
         primary.id AS primary_id,
         src.feed_id AS feed_id,
         f.title AS feed_title
       FROM articles primary
       JOIN articles sibling
         ON sibling.canonical_url_normalized = primary.canonical_url_normalized
         AND sibling.id != primary.id
       JOIN article_sources src ON src.article_id = sibling.id
       JOIN feeds f ON f.id = src.feed_id
       WHERE primary.id IN (${placeholders})
       GROUP BY primary.id, src.feed_id`,
      clusteredIds,
    );
    alsoSeenInMap = buildAlsoSeenInMap(siblingRows);
  }

  // Update cursor on successful return.
  if (sinceLastCall) {
    const now = Date.now();
    await dbRun(
      ctx.db,
      `INSERT INTO mcp_cursors (user_id, tool_name, cursor_at)
       VALUES (?, 'get_recent', ?)
       ON CONFLICT(user_id, tool_name) DO UPDATE SET cursor_at = excluded.cursor_at`,
      [ctx.userId, now],
    );
  }

  if (articleRows.length === 0) {
    return { content: [{ type: 'text', text: 'No recent articles.' }] };
  }

  // Format as markdown for the LLM.
  const lines: string[] = [`# Recent articles (${articleRows.length})\n`];
  for (const r of articleRows) {
    const readMark = r.is_read === 1 ? '[read]' : '[unread]';
    const siblings = alsoSeenInMap.get(r.id) ?? [];
    const siblingNote = siblings.length > 0
      ? `\n  also in: ${siblings.map((s) => s.feed_title || s.feed_id).join(', ')}`
      : '';
    const excerpt = r.excerpt ? `\n  ${r.excerpt.slice(0, 200)}` : '';
    lines.push(
      `- ${readMark} [${r.source_type}] **${r.title}**\n  id: \`${r.id}\`\n  ${r.canonical_url}${siblingNote}${excerpt}`,
    );
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
```

(d) The function still needs to be referenced from `handleToolCall` (probably already is — verify the `case 'get_recent':` branch calls `getRecent(args, ctx)` unchanged).

- [ ] **Step 5: Run tests; verify the helper tests pass**

Run: `npx vitest run src/mcp/__tests__/tools.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Run all tests**

Run: `npm run test`
Expected: all tests pass — no regressions.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools.ts src/mcp/__tests__/tools.test.ts
git commit -m "feat(mcp): get_recent dedup cluster + also_seen_in + is_read + since_last_call cursor"
```

Do NOT push.

---

## Task 5: `get_article` implicit read mark

After fetching an article, UPSERT `article_read_state.is_read = 1`. Best-effort — failure logs and doesn't block the response.

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Locate the existing `getArticle` function**

Run: `grep -n "function getArticle\|case 'get_article'" src/mcp/tools.ts`
Read the function body to understand its current shape.

- [ ] **Step 2: Add the UPSERT after the article fetch and before the return**

Locate the point in `getArticle` AFTER the article body is fetched from D1 AND verified (article exists, user has access) AND BEFORE the `return { content: [...] }` statement. Insert:

```ts
// Implicit read mark — fetching the article is a strong signal of engagement.
// Best-effort: a UPSERT failure logs and doesn't fail the response.
try {
  await dbRun(
    ctx.db,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       is_read = 1,
       updated_at = excluded.updated_at`,
    [ctx.userId, article.id, Date.now()],
  );
} catch (err) {
  console.warn('[get_article] failed to mark read:', err instanceof Error ? err.message : err);
}
```

Note: `article.id` may be named differently in the actual code — use whatever variable holds the verified article id. The `Date.now()` is the third bind.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): get_article implicit read mark via article_read_state UPSERT"
```

Do NOT push.

---

## Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the schema highlights section to mention migration 0030**

Find the section that mentions migrations 0017/0027/0028/0029. Append:

> Migration `0030_intelligence.sql` adds `articles.canonical_url_normalized` (URL-canonicalization dedup key) and the `mcp_cursors` table (per-user, per-tool cursors keyed by `(user_id, tool_name)`). Backfilled existing rows with a SQL-approximated canonicalization; new rows use the full JS helper at INSERT time.

- [ ] **Step 2: Update the source-detect / data flow section**

If CLAUDE.md describes ingestion, add a sentence near it:

> Every article INSERT computes `canonical_url_normalized` via `src/lib/canonical-url.ts` so the `get_recent` MCP tool can collapse "same story from N sources" into one entry with `also_seen_in` provenance.

- [ ] **Step 3: Update the MCP tools section**

If CLAUDE.md describes the MCP tool surface, update the `get_recent` description to mention the new params + result shape:

> `get_recent` returns clustered articles (one per canonical URL) with `is_read: boolean` and `also_seen_in: Array<{feed_id, feed_title}>`. New params: `since_last_call: boolean` (server cursor, mutually exclusive with `since`), `unread_only: boolean`. `get_article` implicitly marks the article as read via `article_read_state`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record migration 0030, canonical-url helper, get_recent dedup + read-state"
```

Do NOT push.

---

## Task 7: End-to-end manual verification

The automated checks verify code and unit tests. Manual verification confirms the cluster + cursor + read-state pipeline works against a real local DB with multiple articles.

**Files:** (none — verification only)

- [ ] **Step 1: Start local dev**

Run: `npm run dev`
Wait for wrangler to start on port 8787 (or 8788).

- [ ] **Step 2: Sign in and obtain a Bearer token**

Same flow as M1/M2/M3 verification — browser sign-in via `/api/auth/sign-in/social/...`, copy the session token.

- [ ] **Step 3: Subscribe to two RSS feeds that share a story**

Pick two feeds that you know syndicate the same content (or use real feeds and inspect after a poll). Simpler: subscribe to one RSS feed, then insert a synthetic article manually to simulate the "two sources, same URL" case:

```bash
TOKEN=<paste your bearer token>

# Subscribe to one real feed
curl -sS -X POST http://localhost:8787/api/feeds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://stratechery.com/feed/"}'
```

Wait for or trigger a poll, then verify the new column is populated:

```bash
curl -sS "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
npx wrangler d1 execute DB --local --command "SELECT id, canonical_url, canonical_url_normalized FROM articles ORDER BY fetched_at DESC LIMIT 5;"
```

Expected: recent articles have non-NULL `canonical_url_normalized` that looks correctly canonicalized.

- [ ] **Step 4: Test `since_last_call` cursor**

First call (no cursor → defaults to last 7 days):

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_recent","arguments":{"since_last_call":true,"limit":5}}}' | jq -r '.result.content[0].text' | head -30
```

Expected: returns up to 5 articles from the last 7 days, each with `[read]` or `[unread]` markers and (if clustered) `also in: ...` lines.

Verify cursor was created:

```bash
npx wrangler d1 execute DB --local --command "SELECT * FROM mcp_cursors;"
```

Expected: one row with your user_id, tool_name='get_recent', cursor_at=recent timestamp.

Second call immediately:

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_recent","arguments":{"since_last_call":true}}}' | jq -r '.result.content[0].text' | head -5
```

Expected: "No recent articles." (cursor advanced; nothing new since the prior call).

- [ ] **Step 5: Test `since`/`since_last_call` mutual exclusion**

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_recent","arguments":{"since":1234567890,"since_last_call":true}}}' | jq -r '.result.content[0].text'
```

Expected: error message about mutual exclusion.

- [ ] **Step 6: Test implicit read mark via `get_article`**

Pick an article id from Step 4's first call. Fetch it:

```bash
ARTICLE_ID=<paste id from step 4>
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"get_article\",\"arguments\":{\"article_id\":\"$ARTICLE_ID\"}}}" > /dev/null
```

Verify the read state was written:

```bash
npx wrangler d1 execute DB --local --command "SELECT * FROM article_read_state WHERE article_id = '$ARTICLE_ID';"
```

Expected: a row with `is_read = 1`.

- [ ] **Step 7: Test `unread_only` filter**

Reset the cursor so we get articles again (or use `since: 0` to bypass cursor):

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_recent","arguments":{"since":0,"unread_only":true,"limit":20}}}' | jq -r '.result.content[0].text'
```

Expected: the article you fetched in Step 6 is NOT in the result.

- [ ] **Step 8: Test URL-canonicalization dedup (synthetic)**

Insert a second article manually with the same canonical_url as one of the real ones (modulo utm params):

```bash
EXISTING_URL=<paste canonical_url from step 3>
ALT_URL="${EXISTING_URL}?utm_source=test"
FEED_ID=<paste a different feed_id you're subscribed to>

# Compute the normalized URL via the helper (or do it by hand for the test).
# For a quick sanity test, just confirm two URLs with different utm params
# normalize to the same string by reading the new column for both rows.
```

Alternatively, write to D1 directly:

```bash
ID2=$(node -e "console.log(require('nanoid').nanoid())")
NORM=$(node -e "
const url = process.argv[1];
// inline approximate canonicalization for the test
const u = new URL(url);
u.hostname = u.hostname.replace(/^www\./, '');
const params = [...u.searchParams.entries()].filter(([k]) => !k.startsWith('utm_'));
u.search = '';
params.sort();
for (const [k, v] of params) u.searchParams.append(k, v);
u.protocol = 'https:';
let p = u.pathname.replace(/\/+$/, ''); if (!p) p = '/';
u.pathname = p;
u.hash = '';
console.log(u.toString());
" "$ALT_URL")

npx wrangler d1 execute DB --local --command "INSERT INTO articles (id, title, canonical_url, canonical_url_normalized, published_at, fetched_at, source_type) VALUES ('$ID2', 'duplicate test', '$ALT_URL', '$NORM', $(date +%s)000, $(date +%s)000, 'rss');"
npx wrangler d1 execute DB --local --command "INSERT INTO article_sources (id, article_id, feed_id, published_at, created_at) VALUES ('$(node -e \"console.log(require('nanoid').nanoid())\")', '$ID2', '$FEED_ID', $(date +%s)000, $(date +%s)000);"
```

(This is fiddly; if it's too much effort, skip and rely on synthetic D1 rows or post-deploy testing.)

After the synthetic INSERT, call `get_recent` and verify the duplicate article DOES NOT appear as a separate entry; instead, the original primary should have `also_seen_in` listing the new feed.

- [ ] **Step 9: Final commit (only if debug fixes were applied)**

If verification surfaced bugs, fix TDD-style. Otherwise skip.

---

## Out of scope (deferred to later milestones)

- Title or content similarity matching for dedup (M4.5 or later).
- Explicit `mark_as_read` / `mark_as_unread` MCP tools (M5).
- "Best of" primary selection within clusters (longest content, highest extraction_quality).
- `read_position_percent` MCP exposure (UI-only field).
- `time_spent_ms_total` exposure as ranking signal.
- Per-tool cursors for `search_articles` or `get_article`.
- Cursor admin/reset endpoints.
- One-shot re-canonicalization script for old rows backfilled with SQL approximation.
- `also_seen_in` in `search_articles` results.
