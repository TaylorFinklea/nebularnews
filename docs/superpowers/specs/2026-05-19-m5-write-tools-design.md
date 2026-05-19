# M5 — MCP Write Tools (Design)

**Date:** 2026-05-19
**Milestone:** M5 of the 6-month roadmap (Phase 2 — Intelligence)
**Roadmap reference:** `docs/superpowers/specs/2026-05-15-roadmap-design.md` → Phase 2 → M5
**Operator:** Single user
**Outcome:** *"I can tell Claude to bookmark / tag / archive — without leaving the chat."*

---

## 1. Goals & non-goals

### Goal

Six new MCP tools so Claude can curate articles directly from the chat. The set-style shape (boolean param toggles direction) keeps each tool reversible without doubling the tool count.

| Tool | Action | Storage |
|---|---|---|
| `set_article_archived(article_id, archived: bool)` | Per-user archive | `article_read_state.archived_at` (new) |
| `set_article_bookmarked(article_id, bookmarked: bool)` | Per-user bookmark | `article_read_state.saved_at` (exists) |
| `set_article_read(article_id, is_read: bool)` | Explicit read-state toggle | `article_read_state.is_read` (exists) |
| `add_article_tag(article_id, tag: string)` | Tag with just-in-time creation | `article_tags` + `tags` |
| `remove_article_tag(article_id, tag: string)` | Untag | `article_tags` |
| `list_tags()` | Read tool — user's tags with use counts | reads `tags`, `article_tags` |

`get_recent` gains an `include_archived: boolean` param (default `false`). Archived articles are hidden by default.

### Non-goals

- **No `delete_article`.** Archive is the soft-delete; everything M5 sets is reversible.
- **No two-phase confirm-proposal pattern.** The `tool_call_proposals` table from migration 0020 was built for the dead chat-app era and references the defunct `chat_threads` table. Roadmap says "probably overkill" for single-user; agreed.
- **No HTTP REST surface for write tools.** MCP-only.
- **No batch tools.** YAGNI — Claude calls in a loop if needed.
- **No tag rename / merge / delete / color-edit tools.**
- **No `bookmarked_only` / `archived_only` filters on `get_recent`** beyond the new `include_archived` toggle.
- **No reading-position write tool.** UI-only field; M4 deferred and M5 keeps that stance.
- **No cleanup of orphaned `tags` rows.** Future maintenance migration.
- **No tag autocomplete inside `add_article_tag`.** LLM can call `list_tags` first if it wants to reuse a name.
- **No reuse of `articles.quarantined_at` for archive.** Quarantine is system-side safety; archive is user-side curation. Separate columns, separate semantics.

---

## 2. Components & data flow

Three pieces, all small.

### A. Migration `0031_write_tools.sql`

```sql
-- M5 — Write tools: per-user archive state.
--
-- archived_at goes on article_read_state alongside the existing per-user
-- fields (is_read, saved_at, read_position_percent, time_spent_ms_total,
-- last_read_at). Archive is the user-side soft-delete: "I'm done with this
-- article." articles.quarantined_at remains the system-side safety filter;
-- distinct concept, distinct storage.

ALTER TABLE article_read_state ADD COLUMN archived_at INTEGER;

-- Partial index — narrow because most users have few archived rows relative
-- to total per-user reading state.
CREATE INDEX idx_article_read_state_archived
  ON article_read_state (user_id, archived_at)
  WHERE archived_at IS NOT NULL;
```

No other schema changes. `tags`, `article_tags`, `article_read_state.is_read`, `article_read_state.saved_at` all exist from migration 0001.

### B. Tag normalization helper — `src/lib/tag-name.ts`

Pure function:

```ts
export interface NormalizedTag {
  name: string;             // display form: trimmed, original case preserved
  nameNormalized: string;   // lookup key: lowercased, whitespace-collapsed
  slug: string;             // URL-safe: lowercase, hyphenated, alphanumeric only
}

export function normalizeTag(rawInput: string): NormalizedTag | { error: string };
```

Rules:
1. Trim. Reject empty (`{ error: 'Tag cannot be empty' }`).
2. Reject if > 60 chars (`{ error: 'Tag too long (max 60 characters)' }`).
3. `name`: trimmed original (preserves user's intended display form).
4. `nameNormalized`: `name.toLowerCase().replace(/\s+/g, ' ')` (whitespace-collapsed lower).
5. `slug`: `nameNormalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')`. Reject if empty (`{ error: 'Tag must contain alphanumeric characters' }`).

Pure function. ~8 fixture tests (whitespace handling, case, edge cases).

### C. New MCP tools + `get_recent` extension — `src/mcp/tools.ts`

Six new tools in `TOOL_DEFINITIONS` + their handlers. Plus extend `get_recent` with `include_archived`.

#### `set_article_archived(article_id, archived: boolean)`

```sql
INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, archived_at)
VALUES (?, ?, 0, ?, ?)
ON CONFLICT(user_id, article_id) DO UPDATE SET
  archived_at = excluded.archived_at,
  updated_at = excluded.updated_at;
```

`archived_at = now` when archived=true, `NULL` when archived=false. ON CONFLICT only updates `archived_at` + `updated_at` — preserves existing `is_read` / `saved_at`.

#### `set_article_bookmarked(article_id, bookmarked: boolean)`

Same UPSERT pattern, target is `saved_at`.

#### `set_article_read(article_id, is_read: boolean)`

Same UPSERT pattern, target is `is_read` (0 or 1). Note: `get_article` already does an implicit `is_read=1` UPSERT from M4 — this is the explicit toggle for "set unread" or "mark read without fetching."

#### `add_article_tag(article_id, tag: string)`

Flow:
1. Validate `article_id` and verify user has access via subscription (same pattern as `get_article`).
2. `normalizeTag(rawTag)` → return error response if invalid.
3. UPSERT into `tags` by `name_normalized` (just-in-time creation):
   ```sql
   INSERT INTO tags (id, name, name_normalized, slug, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(name_normalized) DO UPDATE SET updated_at = excluded.updated_at
   RETURNING id;
   ```
4. INSERT into `article_tags`:
   ```sql
   INSERT INTO article_tags (id, user_id, article_id, tag_id, source, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'manual', ?, ?)
   ON CONFLICT(user_id, article_id, tag_id) DO NOTHING;
   ```

`source = 'manual'` per the schema's allowed values (`manual | ai | system`).

#### `remove_article_tag(article_id, tag: string)`

Flow:
1. `normalizeTag(rawTag)`.
2. Look up tag_id by `name_normalized`. If tag doesn't exist, return idempotent success.
3. `DELETE FROM article_tags WHERE user_id = ? AND article_id = ? AND tag_id = ?`.

#### `list_tags()`

```sql
SELECT t.id, t.name, t.slug, COUNT(at.id) AS use_count
FROM tags t
JOIN article_tags at ON at.tag_id = t.id AND at.user_id = ?
GROUP BY t.id
ORDER BY use_count DESC, t.name ASC;
```

Returns markdown list of the user's tags with use counts. Empty result → "No tags yet."

#### `get_recent` extension

Add `include_archived: boolean` to inputSchema (default `false`). Modify the cluster CTE's outer WHERE to add an archive filter when not included. The existing `ars` LEFT JOIN already covers per-user state — extend the WHERE clause:

```sql
WHERE 1=1 ${unreadClause} ${archivedClause}
```

Where `archivedClause = includeArchived ? '' : 'AND (ars.archived_at IS NULL)'`.

LEFT JOIN semantics ensure articles with no `article_read_state` row appear (they have `ars.archived_at = NULL`).

### Data flow (end-to-end)

```
1. LLM calls add_article_tag('article-123', 'AI safety')
   → normalizeTag → { name: 'AI safety', nameNormalized: 'ai safety', slug: 'ai-safety' }
   → UPSERT tags row (creates if needed)
   → INSERT article_tags row (no-op if already tagged)
   → "Tagged article-123 as 'AI safety'"

2. LLM calls set_article_archived('article-456', true)
   → UPSERT article_read_state SET archived_at = now
   → "Archived article-456"

3. LLM calls get_recent({ unread_only: true })
   → existing cluster CTE
   → outer WHERE adds (ars.archived_at IS NULL) since include_archived is default false
   → article-456 doesn't appear

4. LLM calls get_recent({ include_archived: true })
   → archived filter dropped
   → article-456 appears

5. LLM calls list_tags()
   → returns user's tags sorted by use count

6. LLM calls set_article_archived('article-456', false)
   → UPSERT sets archived_at = NULL
   → article-456 reappears in default get_recent
```

---

## 3. Risks & known unknowns

- **UPSERT default values on first insert.** `set_article_archived(id, true)` on an article the user never touched INSERTs with `is_read = 0` (the schema's CHECK requires a value). Correct semantically — archiving an unread article shouldn't flip the read flag. Documented in code comments per UPSERT.
- **Tag orphans.** When `remove_article_tag` removes the last `article_tags` row for a tag, the `tags` row remains. Cosmetic — `list_tags` joins through `article_tags` so orphans don't surface. Future cleanup migration possible.
- **Tag normalization unicode.** `.toLowerCase()` is locale-naive but stable. All-punctuation or non-Latin slugs collapse to empty and return an error. Accepted.
- **Concurrent tag creation.** Race on `tags` UPSERT handled by the `name_normalized` UNIQUE constraint + `ON CONFLICT DO UPDATE`. No real race.
- **Archive filter performance.** The new partial index on `(user_id, archived_at) WHERE archived_at IS NOT NULL` keeps the cluster CTE's filter fast. Negligible at personal scale.
- **No hard-delete recovery.** A bad archive/tag is recoverable via the corresponding unset call. No M5 path requires deletion.

---

## 4. Testing

- **`src/lib/__tests__/tag-name.test.ts`** (new) — pure-function tests for `normalizeTag`:
  - Whitespace trim preserves case.
  - Mixed-case → `name` keeps original, `nameNormalized` is lowercase, `slug` is hyphenated.
  - Empty input → error.
  - All-punctuation input slugs to empty → error.
  - >60 chars → error.
  - Whitespace-only input → error.
  - Multiple spaces collapse in `nameNormalized`.
  - Idempotence: `normalizeTag(rawNormalizedName)` returns the same normalization.
- **`src/mcp/__tests__/tools.test.ts`** — extend with any pure helpers extracted from the new tool handlers (e.g., a `formatTagListMarkdown` if used). The UPSERTs themselves exercise via manual verification.
- **No fixture tests for the SQL paths** — UPSERTs are single statements; no value over orchestrator-via-manual-verification.

---

## 5. File structure

**Create:**
- `migrations/0031_write_tools.sql` — adds `article_read_state.archived_at` + partial index.
- `src/lib/tag-name.ts` — `normalizeTag` pure helper.
- `src/lib/__tests__/tag-name.test.ts` — 8 fixture tests.

**Modify:**
- `src/mcp/tools.ts` — 6 new tools (`set_article_archived`, `set_article_bookmarked`, `set_article_read`, `add_article_tag`, `remove_article_tag`, `list_tags`) added to `TOOL_DEFINITIONS` and dispatched in `handleToolCall`. `get_recent` extended with `include_archived` param and outer WHERE clause.
- `CLAUDE.md` — document new tools, archive semantics, `get_recent` filter change.

---

## 6. Exit criteria

1. Migration `0031` applies cleanly via `npm run migrate:local`; `article_read_state.archived_at` column exists.
2. `set_article_archived(article_id, true)` UPSERTs `article_read_state.archived_at = now` and that article disappears from default `get_recent` results.
3. `set_article_archived(article_id, false)` clears `archived_at` and the article reappears.
4. `set_article_bookmarked(article_id, true)` UPSERTs `saved_at = now`.
5. `set_article_read(article_id, false)` flips `is_read` to 0 even for articles previously read via `get_article` implicit mark.
6. `add_article_tag(article_id, "AI Safety")` creates the `tags` row if needed and inserts the `article_tags` row. A second identical call is a no-op.
7. `remove_article_tag(article_id, "AI Safety")` deletes the `article_tags` row. Removing a non-existent tag returns idempotent success.
8. `list_tags()` returns the user's tags ordered by use count.
9. `get_recent({ include_archived: true })` includes archived articles.
10. UPSERTs preserve unrelated columns (archiving doesn't reset `is_read`, marking read doesn't reset `saved_at`, etc.).

---

## 7. Sequencing (informs the plan)

1. Migration `0031` first.
2. `tag-name.ts` with fixture tests.
3. 6 new MCP tools + `get_recent` extension (single task — they share infrastructure).
4. CLAUDE.md docs.
5. End-to-end manual verification.

---

## 8. Open follow-ups (not in M5)

- Tag cleanup migration for orphaned `tags` rows.
- Tag rename / merge / delete tools.
- Bookmark/archived filters on `get_recent` beyond the toggle.
- `delete_article` if a real need emerges.
- Batch tools.
- Reading-position write tool.
- HTTP REST surface for any write tool.
- Tag-color editing.
- Two-phase confirm-proposal pattern revival (currently dead post-chat-app pivot).
