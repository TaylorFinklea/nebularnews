# M5 — MCP Write Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six new MCP write tools (`set_article_archived`, `set_article_bookmarked`, `set_article_read`, `add_article_tag`, `remove_article_tag`, `list_tags`) plus a `get_recent` extension (`include_archived`) so Claude can curate articles directly from the chat.

**Architecture:** A single migration adds `article_read_state.archived_at`. A pure `normalizeTag` helper handles tag-name canonicalization. The MCP tools file gains 6 handlers — 3 use the same UPSERT pattern on `article_read_state` (set-style), 2 manage tags (with just-in-time tag creation), and `list_tags` is a read tool. `get_recent` gains a new boolean param and an outer WHERE clause filter.

**Tech Stack:** Cloudflare Workers, Hono, D1 (raw SQL), Vitest. No new npm dependencies.

---

## File Structure

**Create**
- `migrations/0031_write_tools.sql` — `article_read_state.archived_at` column + partial index.
- `src/lib/tag-name.ts` — `normalizeTag(rawInput): NormalizedTag | { error: string }` pure helper.
- `src/lib/__tests__/tag-name.test.ts` — fixture-driven tests.

**Modify**
- `src/mcp/tools.ts` — 6 new tool definitions in `TOOL_DEFINITIONS`; 6 new handlers; `get_recent` extended with `include_archived` param and outer WHERE clause.
- `CLAUDE.md` — document new tools, archive semantics, get_recent filter change.

Each file has one responsibility. The split keeps `tag-name.ts` independently testable.

---

## Sequencing

1. Migration first.
2. `normalizeTag` helper + tests.
3. Three `set_article_*` tools (shared UPSERT pattern on `article_read_state`).
4. Two tag write tools (`add_article_tag`, `remove_article_tag`) — different SQL pattern (tag UPSERT + article_tags).
5. `list_tags` + `get_recent` `include_archived` extension (read-side changes).
6. CLAUDE.md docs.
7. End-to-end manual verification.

---

## Task 1: Migration 0031 — `article_read_state.archived_at`

**Files:**
- Create: `migrations/0031_write_tools.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Migration 0031 — Write tools: per-user archive state.
--
-- M5 of the 6-month roadmap. `archived_at` goes on article_read_state
-- alongside the existing per-user fields (is_read, saved_at,
-- read_position_percent, time_spent_ms_total, last_read_at). Archive is
-- the user-side soft-delete: "I'm done with this article."
-- articles.quarantined_at remains the system-side safety filter (used by
-- M3 email TOFU). Distinct concept, distinct storage.

ALTER TABLE article_read_state ADD COLUMN archived_at INTEGER;

CREATE INDEX idx_article_read_state_archived
  ON article_read_state (user_id, archived_at)
  WHERE archived_at IS NOT NULL;
```

- [ ] **Step 2: Apply locally**

Run: `npm run migrate:local`
Expected: applies `0031_write_tools.sql` without error.

- [ ] **Step 3: Verify the new column**

Run: `npx wrangler d1 execute DB --local --command "PRAGMA table_info(article_read_state);" 2>&1 | grep archived_at`
Expected: a row showing `archived_at INTEGER` (nullable).

- [ ] **Step 4: Verify the partial index**

Run: `npx wrangler d1 execute DB --local --command "SELECT name, sql FROM sqlite_master WHERE name = 'idx_article_read_state_archived';"`
Expected: index with `WHERE archived_at IS NOT NULL` clause.

- [ ] **Step 5: Commit**

```bash
git add migrations/0031_write_tools.sql
git commit -m "feat(db): migration 0031 — article_read_state.archived_at for M5"
```

Do NOT push.

---

## Task 2: `normalizeTag` helper + fixture tests

Pure function for tag-name canonicalization. The LLM passes raw strings; we need deterministic normalization for matching.

**Files:**
- Create: `src/lib/__tests__/tag-name.test.ts`
- Create: `src/lib/tag-name.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/tag-name.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeTag } from '../tag-name';

describe('normalizeTag', () => {
  it('preserves original case in name and lowercases in nameNormalized', () => {
    expect(normalizeTag('AI Safety')).toEqual({
      name: 'AI Safety',
      nameNormalized: 'ai safety',
      slug: 'ai-safety',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTag('  hello world  ')).toEqual({
      name: 'hello world',
      nameNormalized: 'hello world',
      slug: 'hello-world',
    });
  });

  it('collapses internal whitespace in nameNormalized', () => {
    expect(normalizeTag('foo    bar')).toMatchObject({
      nameNormalized: 'foo bar',
      slug: 'foo-bar',
    });
  });

  it('replaces punctuation in slug with hyphens', () => {
    expect(normalizeTag('hello, world!')).toMatchObject({
      nameNormalized: 'hello, world!',
      slug: 'hello-world',
    });
  });

  it('returns error for empty input', () => {
    expect(normalizeTag('')).toEqual({ error: 'Tag cannot be empty' });
  });

  it('returns error for whitespace-only input', () => {
    expect(normalizeTag('   ')).toEqual({ error: 'Tag cannot be empty' });
  });

  it('returns error when slug is empty after slugging', () => {
    const result = normalizeTag('!!!');
    expect(result).toEqual({ error: 'Tag must contain alphanumeric characters' });
  });

  it('returns error for tags longer than 60 characters', () => {
    const longTag = 'a'.repeat(61);
    expect(normalizeTag(longTag)).toEqual({ error: 'Tag too long (max 60 characters)' });
  });

  it('accepts exactly 60 characters', () => {
    const tag = 'a'.repeat(60);
    const result = normalizeTag(tag);
    expect(result).not.toHaveProperty('error');
  });

  it('is idempotent on the slug for already-normalized input', () => {
    const once = normalizeTag('ai safety');
    expect(once).toMatchObject({ slug: 'ai-safety' });
    // Feed the slug back through and check it stays slug-shaped.
    const twice = normalizeTag('ai-safety');
    expect(twice).toMatchObject({ slug: 'ai-safety' });
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/lib/__tests__/tag-name.test.ts`
Expected: 10 tests fail — module not found.

- [ ] **Step 3: Implement normalizeTag**

Create `src/lib/tag-name.ts`:

```ts
// Tag-name canonicalization for the M5 write tools.
//
// The LLM passes raw strings via add_article_tag / remove_article_tag.
// We need deterministic normalization so:
//   - "AI Safety" and "ai safety" hit the same tag row (name_normalized match)
//   - The display form preserves the user's intended case
//   - The slug is URL-safe for any future UI
// Pure function — no DB, no side effects. Returns either the normalized
// shape or an error string suitable for direct surfacing to the LLM.

export interface NormalizedTag {
  name: string;             // display form: trimmed, original case preserved
  nameNormalized: string;   // lookup key: lowercased, whitespace-collapsed
  slug: string;             // URL-safe: lowercase, hyphenated, alphanumeric
}

const MAX_TAG_LENGTH = 60;

export function normalizeTag(rawInput: string): NormalizedTag | { error: string } {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { error: 'Tag cannot be empty' };
  }
  if (trimmed.length > MAX_TAG_LENGTH) {
    return { error: `Tag too long (max ${MAX_TAG_LENGTH} characters)` };
  }

  const nameNormalized = trimmed.toLowerCase().replace(/\s+/g, ' ');
  const slug = nameNormalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) {
    return { error: 'Tag must contain alphanumeric characters' };
  }

  return { name: trimmed, nameNormalized, slug };
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/tag-name.test.ts`
Expected: 10 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tag-name.ts src/lib/__tests__/tag-name.test.ts
git commit -m "feat(tag-name): normalizeTag helper with fixture tests"
```

Do NOT push.

---

## Task 3: Three `set_article_*` tools (shared UPSERT pattern)

Three MCP tools that toggle per-user state on `article_read_state`: archived, bookmarked, is_read. Each follows the same UPSERT shape — only the column being updated differs.

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Add tool definitions to `TOOL_DEFINITIONS`**

In `src/mcp/tools.ts`, find the `TOOL_DEFINITIONS` array. Insert these three new entries (recommended location: after `get_article`, before the closing bracket):

```ts
{
  name: 'set_article_archived',
  description: 'Archive or unarchive an article (per-user, soft-delete). Archived articles are hidden from get_recent by default; pass include_archived: true to see them. Reversible — call again with archived: false.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      article_id: { type: 'string', description: 'Article id (from search_articles or get_recent)' },
      archived: { type: 'boolean', description: 'true to archive, false to unarchive' },
    },
    required: ['article_id', 'archived'],
  },
},
{
  name: 'set_article_bookmarked',
  description: 'Bookmark or unbookmark an article (per-user). Bookmarked state is stored alongside read state but does not currently filter get_recent.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      article_id: { type: 'string', description: 'Article id (from search_articles or get_recent)' },
      bookmarked: { type: 'boolean', description: 'true to bookmark, false to remove bookmark' },
    },
    required: ['article_id', 'bookmarked'],
  },
},
{
  name: 'set_article_read',
  description: 'Explicitly mark an article as read or unread. Note: get_article already marks an article as read implicitly when fetched; use set_article_read to mark unread or to mark read without fetching.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      article_id: { type: 'string', description: 'Article id (from search_articles or get_recent)' },
      is_read: { type: 'boolean', description: 'true to mark read, false to mark unread' },
    },
    required: ['article_id', 'is_read'],
  },
},
```

- [ ] **Step 2: Add dispatch cases to `handleToolCall`**

Find the `handleToolCall` function's switch statement. Add three new cases (next to `get_article`):

```ts
case 'set_article_archived':   return setArticleArchived(args, ctx);
case 'set_article_bookmarked': return setArticleBookmarked(args, ctx);
case 'set_article_read':       return setArticleRead(args, ctx);
```

- [ ] **Step 3: Add the three handler functions**

In the same file, add the three handlers (location: near the other handlers like `getRecent`, `getArticle`). Each handler validates inputs, verifies the article exists, then runs the UPSERT.

```ts
// ---------------------------------------------------------------------------
// set_article_archived / set_article_bookmarked / set_article_read
//
// Three set-style write tools that toggle per-user state on
// article_read_state. Each UPSERTs (user_id, article_id) and only updates
// the relevant column on conflict — preserving other state. The first INSERT
// sets is_read = 0 as the default (the schema's CHECK constraint requires
// it); existing rows have their existing is_read preserved.
// ---------------------------------------------------------------------------

async function verifyArticleExists(ctx: ToolContext, articleId: string): Promise<boolean> {
  const row = await dbGet<{ id: string }>(
    ctx.db,
    `SELECT id FROM articles WHERE id = ?`,
    [articleId],
  );
  return row !== null;
}

async function setArticleArchived(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = typeof args.article_id === 'string' ? args.article_id : '';
  const archived = args.archived === true;
  if (!articleId) {
    return { content: [{ type: 'text', text: 'Missing article_id.' }] };
  }
  if (!(await verifyArticleExists(ctx, articleId))) {
    return { content: [{ type: 'text', text: `Article ${articleId} not found.` }] };
  }
  const now = Date.now();
  const archivedAt = archived ? now : null;
  await dbRun(
    ctx.db,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, archived_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       archived_at = excluded.archived_at,
       updated_at = excluded.updated_at`,
    [ctx.userId, articleId, now, archivedAt],
  );
  return {
    content: [{
      type: 'text',
      text: archived ? `Archived article ${articleId}.` : `Unarchived article ${articleId}.`,
    }],
  };
}

async function setArticleBookmarked(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = typeof args.article_id === 'string' ? args.article_id : '';
  const bookmarked = args.bookmarked === true;
  if (!articleId) {
    return { content: [{ type: 'text', text: 'Missing article_id.' }] };
  }
  if (!(await verifyArticleExists(ctx, articleId))) {
    return { content: [{ type: 'text', text: `Article ${articleId} not found.` }] };
  }
  const now = Date.now();
  const savedAt = bookmarked ? now : null;
  await dbRun(
    ctx.db,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at, saved_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       saved_at = excluded.saved_at,
       updated_at = excluded.updated_at`,
    [ctx.userId, articleId, now, savedAt],
  );
  return {
    content: [{
      type: 'text',
      text: bookmarked ? `Bookmarked article ${articleId}.` : `Unbookmarked article ${articleId}.`,
    }],
  };
}

async function setArticleRead(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = typeof args.article_id === 'string' ? args.article_id : '';
  const isRead = args.is_read === true;
  if (!articleId) {
    return { content: [{ type: 'text', text: 'Missing article_id.' }] };
  }
  if (!(await verifyArticleExists(ctx, articleId))) {
    return { content: [{ type: 'text', text: `Article ${articleId} not found.` }] };
  }
  const now = Date.now();
  await dbRun(
    ctx.db,
    `INSERT INTO article_read_state (user_id, article_id, is_read, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       is_read = excluded.is_read,
       updated_at = excluded.updated_at`,
    [ctx.userId, articleId, isRead ? 1 : 0, now],
  );
  return {
    content: [{
      type: 'text',
      text: isRead ? `Marked article ${articleId} as read.` : `Marked article ${articleId} as unread.`,
    }],
  };
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run all tests**

Run: `npm run test`
Expected: 133 tests pass (no new tests; orchestrators verified via manual).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): set_article_archived/bookmarked/read write tools"
```

Do NOT push.

---

## Task 4: Two tag write tools (`add_article_tag`, `remove_article_tag`)

Two MCP tools that manage per-user article tagging. `add_article_tag` upserts a row into `tags` (just-in-time creation by `name_normalized`) and inserts into `article_tags`. `remove_article_tag` looks up the tag and deletes the `article_tags` row.

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Add tool definitions to `TOOL_DEFINITIONS`**

In `src/mcp/tools.ts`, add two more entries to `TOOL_DEFINITIONS`:

```ts
{
  name: 'add_article_tag',
  description: 'Tag an article. Tags are created on first use (no separate "create tag" step needed). Pass any human-readable string; the server normalizes case and whitespace. Idempotent — re-tagging the same article is a no-op.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      article_id: { type: 'string', description: 'Article id (from search_articles or get_recent)' },
      tag: { type: 'string', description: 'Tag name (any case, any whitespace; server normalizes). Examples: "AI Safety", "weekly review", "interesting".' },
    },
    required: ['article_id', 'tag'],
  },
},
{
  name: 'remove_article_tag',
  description: 'Remove a tag from an article. Idempotent — succeeds even if the article wasn\'t tagged.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      article_id: { type: 'string', description: 'Article id' },
      tag: { type: 'string', description: 'Tag name (any case; server normalizes for lookup)' },
    },
    required: ['article_id', 'tag'],
  },
},
```

- [ ] **Step 2: Add the dispatch cases**

In `handleToolCall`, add:

```ts
case 'add_article_tag':    return addArticleTag(args, ctx);
case 'remove_article_tag': return removeArticleTag(args, ctx);
```

- [ ] **Step 3: Add imports for nanoid + normalizeTag**

In `src/mcp/tools.ts` imports near the top, ensure these are present (add if missing):

```ts
import { nanoid } from 'nanoid';
import { normalizeTag } from '../lib/tag-name';
```

(`nanoid` may already be imported for the existing `add_feed` flow — check before duplicating.)

- [ ] **Step 4: Add the two handler functions**

In `src/mcp/tools.ts`, add the handlers near the other tool implementations:

```ts
// ---------------------------------------------------------------------------
// add_article_tag / remove_article_tag
//
// Tags are normalized via src/lib/tag-name.ts. Tags get just-in-time
// creation: the first time a normalized name is referenced, we INSERT into
// the global tags table (UNIQUE on name_normalized) and link via article_tags.
// article_tags has UNIQUE(user_id, article_id, tag_id) so re-tagging is a
// no-op.
// ---------------------------------------------------------------------------

async function addArticleTag(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = typeof args.article_id === 'string' ? args.article_id : '';
  const rawTag = typeof args.tag === 'string' ? args.tag : '';
  if (!articleId) {
    return { content: [{ type: 'text', text: 'Missing article_id.' }] };
  }
  const normalized = normalizeTag(rawTag);
  if ('error' in normalized) {
    return { content: [{ type: 'text', text: normalized.error }] };
  }
  if (!(await verifyArticleExists(ctx, articleId))) {
    return { content: [{ type: 'text', text: `Article ${articleId} not found.` }] };
  }

  const now = Date.now();

  // UPSERT into tags by name_normalized. Use RETURNING to get the id of
  // either the inserted or pre-existing row.
  const tagRow = await dbGet<{ id: string }>(
    ctx.db,
    `INSERT INTO tags (id, name, name_normalized, slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name_normalized) DO UPDATE SET updated_at = excluded.updated_at
     RETURNING id`,
    [nanoid(), normalized.name, normalized.nameNormalized, normalized.slug, now, now],
  );
  if (!tagRow) {
    return { content: [{ type: 'text', text: 'Failed to create or look up tag.' }] };
  }

  // Insert into article_tags. UNIQUE(user_id, article_id, tag_id) makes
  // re-tagging idempotent.
  await dbRun(
    ctx.db,
    `INSERT INTO article_tags (id, user_id, article_id, tag_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?)
     ON CONFLICT(user_id, article_id, tag_id) DO NOTHING`,
    [nanoid(), ctx.userId, articleId, tagRow.id, now, now],
  );

  return {
    content: [{
      type: 'text',
      text: `Tagged article ${articleId} as "${normalized.name}".`,
    }],
  };
}

async function removeArticleTag(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const articleId = typeof args.article_id === 'string' ? args.article_id : '';
  const rawTag = typeof args.tag === 'string' ? args.tag : '';
  if (!articleId) {
    return { content: [{ type: 'text', text: 'Missing article_id.' }] };
  }
  const normalized = normalizeTag(rawTag);
  if ('error' in normalized) {
    return { content: [{ type: 'text', text: normalized.error }] };
  }

  // Look up the tag id. If the tag doesn't exist, return idempotent success.
  const tagRow = await dbGet<{ id: string }>(
    ctx.db,
    `SELECT id FROM tags WHERE name_normalized = ?`,
    [normalized.nameNormalized],
  );
  if (!tagRow) {
    return {
      content: [{ type: 'text', text: `Tag "${normalized.name}" wasn't on article ${articleId}.` }],
    };
  }

  await dbRun(
    ctx.db,
    `DELETE FROM article_tags
       WHERE user_id = ? AND article_id = ? AND tag_id = ?`,
    [ctx.userId, articleId, tagRow.id],
  );

  return {
    content: [{
      type: 'text',
      text: `Removed tag "${normalized.name}" from article ${articleId}.`,
    }],
  };
}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run all tests**

Run: `npm run test`
Expected: 133 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): add_article_tag/remove_article_tag with just-in-time tag creation"
```

Do NOT push.

---

## Task 5: `list_tags` + `get_recent` `include_archived` extension

`list_tags` is a read tool that returns the user's tags with use counts. `get_recent` gains `include_archived: boolean` (default `false`) that, when omitted or false, filters out articles where `article_read_state.archived_at IS NOT NULL`.

**Files:**
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Add `list_tags` tool definition**

Add to `TOOL_DEFINITIONS`:

```ts
{
  name: 'list_tags',
  description: 'List the tags the user has applied to articles, sorted by use count (most-used first). Useful before add_article_tag if the LLM wants to reuse an existing tag name.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
},
```

- [ ] **Step 2: Add `list_tags` dispatch case**

In `handleToolCall`:

```ts
case 'list_tags': return listTags(args, ctx);
```

- [ ] **Step 3: Add `listTags` handler**

In `src/mcp/tools.ts`:

```ts
async function listTags(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const rows = await dbAll<{ id: string; name: string; slug: string; use_count: number }>(
    ctx.db,
    `SELECT t.id, t.name, t.slug, COUNT(at.id) AS use_count
       FROM tags t
       JOIN article_tags at ON at.tag_id = t.id AND at.user_id = ?
      GROUP BY t.id
      ORDER BY use_count DESC, t.name ASC`,
    [ctx.userId],
  );

  if (rows.length === 0) {
    return { content: [{ type: 'text', text: 'No tags yet. Use add_article_tag to create one.' }] };
  }

  const lines = [`# Tags (${rows.length})\n`];
  for (const r of rows) {
    lines.push(`- **${r.name}** (${r.use_count} article${r.use_count === 1 ? '' : 's'}) — id: \`${r.id}\``);
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
```

- [ ] **Step 4: Update `get_recent` tool definition with new param**

Find the existing `get_recent` entry in `TOOL_DEFINITIONS`. Inside its `inputSchema.properties`, add the `include_archived` field alongside the existing params:

```ts
include_archived: {
  type: 'boolean',
  description: 'When true, include articles you have archived via set_article_archived. Default false (archived articles are hidden).',
},
```

- [ ] **Step 5: Extend `getRecent` to honor `include_archived`**

In the `getRecent` function, near where existing args are read (the lines that read `unread_only`, `since_last_call`, etc.), add:

```ts
const includeArchived = args.include_archived === true;
```

Then locate the existing line that builds `unreadClause`:

```ts
const unreadClause = unreadOnly ? `AND (ars.is_read IS NULL OR ars.is_read = 0)` : '';
```

Below it, add:

```ts
const archivedClause = includeArchived ? '' : `AND (ars.archived_at IS NULL)`;
```

Then locate the line where `unreadClause` is interpolated into the outer SELECT (look for `WHERE 1=1 ${unreadClause}`). Extend it to also include `archivedClause`:

```ts
WHERE 1=1 ${unreadClause} ${archivedClause}
```

The existing `ars` LEFT JOIN already covers per-user state — `archived_at` is on the same row as `is_read`, so no new JOIN needed.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Run all tests**

Run: `npm run test`
Expected: 133 tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(mcp): list_tags + get_recent include_archived filter"
```

Do NOT push.

---

## Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the schema highlights section**

Find the section mentioning recent migrations (0017/0027/0028/0029/0030). Append:

> Migration `0031_write_tools.sql` adds `article_read_state.archived_at` (partial-indexed per-user soft-delete) used by the M5 write tools. Quarantine semantics (system-side, `articles.quarantined_at` from migration 0017) stay distinct from archive (user-side curation).

- [ ] **Step 2: Update the MCP tools section**

Find the section describing MCP tools. After the existing `get_recent` / `get_article` notes, add:

> M5 added six write tools: `set_article_archived(id, archived)`, `set_article_bookmarked(id, bookmarked)`, `set_article_read(id, is_read)`, `add_article_tag(id, tag)`, `remove_article_tag(id, tag)`, and `list_tags()`. The three `set_article_*` tools UPSERT per-user state in `article_read_state` (preserving unrelated columns on conflict). Tags get just-in-time creation: `add_article_tag` UPSERTs `tags` by `name_normalized` and links via `article_tags`. Normalization is in `src/lib/tag-name.ts` (pure, fixture-tested).
>
> `get_recent` gained an `include_archived: boolean` param (default `false`). Archived articles are hidden from default results.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record M5 write tools, migration 0031, get_recent archive filter"
```

Do NOT push.

---

## Task 7: End-to-end manual verification

The automated checks verify types and unit tests. Manual verification confirms the UPSERT semantics, idempotence, archive filter, and tag flows work against a real local DB.

**Files:** (none — verification only)

- [ ] **Step 1: Apply migration and start dev**

Run: `npm run migrate:local`
Then: `npm run dev`
Wait for wrangler to start on port 8787/8788.

- [ ] **Step 2: Sign in and obtain a Bearer token**

Same flow as previous milestones. Save the token to `$TOKEN` env var.

- [ ] **Step 3: Pick an article id**

```bash
TOKEN=<paste your bearer token>

curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_recent","arguments":{"limit":3}}}' | jq -r '.result.content[0].text' | head -20
```

Pick one of the returned article ids; set `ARTICLE=<paste id>`.

- [ ] **Step 4: Test set_article_archived**

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"set_article_archived\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"archived\":true}}}" | jq -r '.result.content[0].text'
```

Expected: `Archived article ...`. Then verify the article is hidden:

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_recent","arguments":{"limit":50}}}' | jq -r '.result.content[0].text' | grep -F "$ARTICLE" || echo "Article hidden (as expected)"
```

Expected: "Article hidden". And with the toggle:

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_recent","arguments":{"limit":50,"include_archived":true}}}' | jq -r '.result.content[0].text' | grep -F "$ARTICLE" && echo "Article appears with include_archived"
```

- [ ] **Step 5: Test UPSERT column preservation**

Mark read, then archive, then verify both flags coexist:

```bash
# Set is_read = 1
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"set_article_read\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"is_read\":true}}}" > /dev/null

# Set archived = true (should not reset is_read)
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"set_article_archived\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"archived\":true}}}" > /dev/null

# Verify both flags
npx wrangler d1 execute DB --local --command "SELECT is_read, archived_at, saved_at FROM article_read_state WHERE article_id = '$ARTICLE';"
```

Expected: row with `is_read = 1` AND `archived_at` is a non-null integer. UPSERT preserved is_read.

- [ ] **Step 6: Test add_article_tag idempotence**

```bash
# Tag the article
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"add_article_tag\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"tag\":\"AI Safety\"}}}" | jq -r '.result.content[0].text'

# Tag again — should be idempotent
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"add_article_tag\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"tag\":\"ai safety\"}}}" | jq -r '.result.content[0].text'

# Verify only one row in article_tags
npx wrangler d1 execute DB --local --command "SELECT COUNT(*) FROM article_tags WHERE article_id = '$ARTICLE';"
```

Expected: count = 1 (the second tag normalized to the same name_normalized).

- [ ] **Step 7: Test list_tags**

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"list_tags","arguments":{}}}' | jq -r '.result.content[0].text'
```

Expected: shows "AI Safety" with use count = 1.

- [ ] **Step 8: Test remove_article_tag**

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"remove_article_tag\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"tag\":\"AI Safety\"}}}" | jq -r '.result.content[0].text'

# Idempotent removal
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"remove_article_tag\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"tag\":\"AI Safety\"}}}" | jq -r '.result.content[0].text'
```

Expected: first call removes; second call returns idempotent success message.

- [ ] **Step 9: Test bookmark**

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"set_article_bookmarked\",\"arguments\":{\"article_id\":\"$ARTICLE\",\"bookmarked\":true}}}" | jq -r '.result.content[0].text'

npx wrangler d1 execute DB --local --command "SELECT saved_at FROM article_read_state WHERE article_id = '$ARTICLE';"
```

Expected: saved_at is a non-null integer.

- [ ] **Step 10: Reset and final-commit (only if any fixes were needed)**

If verification surfaced any bugs, fix them TDD-style. Otherwise skip.

---

## Out of scope (deferred to later milestones)

- `delete_article` MCP tool (archive replaces it).
- Batch tools.
- Tag rename/merge/delete tools.
- Bookmark/archived filters on `get_recent` beyond `include_archived`.
- Reading-position write tool.
- HTTP REST surface for write tools.
- Tag-color editing.
- Cleanup migration for orphaned `tags` rows.
- Two-phase confirm-proposal pattern revival.
