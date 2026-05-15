# M1 — Social Feeds (Bluesky / Mastodon / HN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bluesky author feeds, Mastodon user feeds, and Hacker News front-page subscribable through the existing `add_feed` surface and pollable on the 5-minute cron — outcome 1 of the 6-month roadmap.

**Architecture:** Mastodon and HN are RSS-shaped; they piggyback on the existing `poll-feeds.ts` poller, with detection-only changes in `source-detect.ts` to normalize to their RSS endpoints. Bluesky uses ATProto JSON over the public unauthenticated `app.bsky.feed.getAuthorFeed` endpoint, mirroring how `poll-reddit.ts` works — a new sibling poller `poll-bluesky.ts` dispatched from `src/index.ts`. No migration is needed: `feeds.source_type` is `TEXT NOT NULL` with no CHECK constraint, so adding `'mastodon'`, `'hn'`, `'bluesky'` values is a code-only change.

**Tech Stack:** Cloudflare Workers, Hono, D1 (raw SQL via `db/helpers.ts`), `fast-xml-parser` for RSS, native `fetch` for ATProto JSON, Vitest for pure-function unit tests.

---

## File Structure

**Modify**
- `src/lib/source-detect.ts` — extend `SourceType` union, add detection regexes for HN, Mastodon, Bluesky.
- `src/cron/poll-feeds.ts` — extend the `source_type IN (...)` filter to include `'mastodon'` and `'hn'`.
- `src/index.ts` — dispatch `pollBluesky` from the `*/5 * * * *` cron handler.
- `CLAUDE.md` — update Cron→handler table; mention new source types in architecture section.

**Create**
- `src/cron/poll-bluesky.ts` — Bluesky author-feed poller; sibling to `poll-reddit.ts`.
- `src/lib/bluesky.ts` — pure helpers: AT-URI → bsky.app URL, parse author-feed response, build handle-resolution URL.
- `src/lib/__tests__/source-detect.test.ts` — pattern-detection tests (covers existing 4 types + 3 new ones).
- `src/lib/__tests__/bluesky.test.ts` — pure-function tests for the helpers.
- `src/lib/__tests__/feed-parser.test.ts` — fixture-driven RSS parser tests for Mastodon and HN dialects (also acts as the first regression coverage for `feed-parser.ts`, which has none today).
- `src/lib/__tests__/fixtures/bluesky-author-feed.json` — captured ATProto sample response.
- `src/lib/__tests__/fixtures/mastodon-user-feed.xml` — trimmed real Mastodon `.rss` sample.
- `src/lib/__tests__/fixtures/hn-front-page.xml` — trimmed HN front-page RSS sample.

Each file has one responsibility. The `poll-bluesky.ts` poller is intentionally thin — orchestration only; all parsing/normalization lives in `src/lib/bluesky.ts` so it can be unit-tested without a DB or network.

---

## Sequencing

1. Add a baseline regression test file for `source-detect.ts` (currently untested).
2. Add HN, Mastodon, Bluesky detection patterns (TDD: one source type per task).
3. Extend `poll-feeds.ts` to include Mastodon + HN in its query.
4. Add fixture-driven regression tests for `feed-parser.ts` via Mastodon + HN samples.
5. Build Bluesky pure helpers (AT-URI conversion, response parsing).
6. Build `poll-bluesky.ts` and wire it into the cron dispatcher.
7. Update CLAUDE.md.
8. Manual end-to-end verification with real feeds.

---

## Task 1: Regression-coverage test file for source-detect.ts

The file currently has zero tests. Before adding new patterns, lock in existing behavior — otherwise we won't notice if a regex change for Mastodon accidentally breaks Reddit.

**Files:**
- Create: `src/lib/__tests__/source-detect.test.ts`

- [ ] **Step 1: Create the test file with regression coverage for existing 4 source types**

```ts
// src/lib/__tests__/source-detect.test.ts
import { describe, it, expect } from 'vitest';
import { detectSource, expandFetchUrl } from '../source-detect';

describe('detectSource — existing patterns (regression)', () => {
  it('detects subreddit shorthand', () => {
    expect(detectSource('r/birding')).toEqual({
      type: 'reddit', url: 'r/birding', displayLabel: 'r/birding',
    });
  });

  it('detects subreddit URLs and lowercases', () => {
    expect(detectSource('https://www.reddit.com/r/Birding/')).toEqual({
      type: 'reddit', url: 'r/birding', displayLabel: 'r/birding',
    });
  });

  it('detects YouTube channel URLs', () => {
    const r = detectSource('https://www.youtube.com/channel/UC1234567890123456789012');
    expect(r).toMatchObject({ type: 'youtube', url: 'UC1234567890123456789012' });
  });

  it('rejects YouTube @handles with a helpful message', () => {
    const r = detectSource('https://youtube.com/@mkbhd');
    expect(r).toHaveProperty('error');
  });

  it('detects Substack URLs and normalizes to /feed', () => {
    expect(detectSource('https://stratechery.substack.com')).toEqual({
      type: 'substack',
      url: 'https://stratechery.substack.com/feed',
      displayLabel: 'stratechery.substack.com',
    });
  });

  it('falls through to rss for arbitrary http URLs', () => {
    expect(detectSource('https://example.com/feed.xml')).toEqual({
      type: 'rss', url: 'https://example.com/feed.xml', displayLabel: 'https://example.com/feed.xml',
    });
  });

  it('returns an error for empty input', () => {
    expect(detectSource('')).toEqual({ error: 'Empty source identifier' });
  });
});

describe('expandFetchUrl — existing types', () => {
  it('expands subreddit shorthand to the .json listing URL', () => {
    expect(expandFetchUrl('reddit', 'r/birding')).toBe(
      'https://www.reddit.com/r/birding/.json?limit=25',
    );
  });

  it('expands a YouTube channel ID to the uploads xml feed', () => {
    expect(expandFetchUrl('youtube', 'UCabc')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc',
    );
  });

  it('passes rss URLs through unchanged', () => {
    expect(expandFetchUrl('rss', 'https://example.com/feed.xml')).toBe(
      'https://example.com/feed.xml',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they all pass against current code**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts`
Expected: all 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/source-detect.test.ts
git commit -m "test(source-detect): regression coverage for existing patterns"
```

---

## Task 2: Add Hacker News detection

HN is the simplest of the three — a stable RSS endpoint at `https://news.ycombinator.com/rss`. We accept multiple input forms and normalize.

**Files:**
- Modify: `src/lib/source-detect.ts`
- Modify: `src/lib/__tests__/source-detect.test.ts`

- [ ] **Step 1: Write failing tests for HN detection**

Append to `src/lib/__tests__/source-detect.test.ts`:

```ts
describe('detectSource — Hacker News', () => {
  it('detects news.ycombinator.com host', () => {
    expect(detectSource('https://news.ycombinator.com')).toEqual({
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
      displayLabel: 'Hacker News',
    });
  });

  it('detects the bare hostname', () => {
    expect(detectSource('news.ycombinator.com')).toMatchObject({ type: 'hn' });
  });

  it('detects the rss URL directly', () => {
    expect(detectSource('https://news.ycombinator.com/rss')).toMatchObject({
      type: 'hn',
      url: 'https://news.ycombinator.com/rss',
    });
  });

  it('accepts the "hn" shorthand', () => {
    expect(detectSource('hn')).toMatchObject({ type: 'hn' });
  });
});
```

- [ ] **Step 2: Run the new tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts -t "Hacker News"`
Expected: 4 tests fail (current code falls through to `rss` type, not `hn`).

- [ ] **Step 3: Add the HN pattern to source-detect.ts**

In `src/lib/source-detect.ts`:

```ts
// 1) Extend the union near the top of the file:
export type SourceType = 'rss' | 'reddit' | 'youtube' | 'substack' | 'hn' | 'mastodon' | 'bluesky';

// 2) Add the regex near the other patterns:
const HN_RE = /^(?:https?:\/\/)?(?:www\.)?news\.ycombinator\.com\b/i;

// 3) Inside detectSource(), BEFORE the Substack block and BEFORE the
//    generic "http(s) → rss" fallthrough, add:
if (input.toLowerCase() === 'hn' || HN_RE.test(input)) {
  return {
    type: 'hn',
    url: 'https://news.ycombinator.com/rss',
    displayLabel: 'Hacker News',
  };
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts`
Expected: all tests pass (10 existing + 4 new = 14).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. The `SourceType` widening is backward compatible.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-detect.ts src/lib/__tests__/source-detect.test.ts
git commit -m "feat(source-detect): recognize Hacker News URLs and 'hn' shorthand"
```

---

## Task 3: Add Mastodon detection

Mastodon is federated — there's no fixed host. Accept the two common URL forms (`https://<instance>/@user` and `https://<instance>/users/<user>`) and the @user@instance fediverse form. Normalize to the Mastodon RSS endpoint: `https://<instance>/@<user>.rss`.

**Files:**
- Modify: `src/lib/source-detect.ts`
- Modify: `src/lib/__tests__/source-detect.test.ts`

- [ ] **Step 1: Write failing tests for Mastodon detection**

Append to `src/lib/__tests__/source-detect.test.ts`:

```ts
describe('detectSource — Mastodon', () => {
  it('detects mastodon.social @user URL', () => {
    expect(detectSource('https://mastodon.social/@gargron')).toEqual({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
      displayLabel: '@gargron@mastodon.social',
    });
  });

  it('detects /users/<user> form', () => {
    expect(detectSource('https://hachyderm.io/users/molly0xfff')).toMatchObject({
      type: 'mastodon',
      url: 'https://hachyderm.io/@molly0xfff.rss',
    });
  });

  it('detects fediverse @user@instance shorthand', () => {
    expect(detectSource('@gargron@mastodon.social')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
    });
  });

  it('accepts the explicit .rss URL unchanged', () => {
    expect(detectSource('https://mastodon.social/@gargron.rss')).toMatchObject({
      type: 'mastodon',
      url: 'https://mastodon.social/@gargron.rss',
    });
  });

  it('rejects mastodon.social hashtag URLs (not supported yet)', () => {
    const r = detectSource('https://mastodon.social/tags/birding');
    expect(r).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run the new tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts -t "Mastodon"`
Expected: 5 tests fail.

- [ ] **Step 3: Add the Mastodon patterns**

In `src/lib/source-detect.ts`:

```ts
// Add regexes near the others:
const MASTODON_AT_RE = /^@([a-zA-Z0-9_]+)@([a-z0-9.-]+\.[a-z]{2,})$/i;
const MASTODON_USER_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\/@([a-zA-Z0-9_]+)(?:\.rss)?\/?$/i;
const MASTODON_USERS_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\/users\/([a-zA-Z0-9_]+)\/?$/i;
const MASTODON_TAGS_URL_RE = /^https?:\/\/([a-z0-9.-]+\.[a-z]{2,})\/tags\/[a-zA-Z0-9_]+\/?$/i;

// Helper, defined inside the file at module scope:
function buildMastodonDetection(instance: string, user: string): DetectedSource {
  return {
    type: 'mastodon',
    url: `https://${instance}/@${user}.rss`,
    displayLabel: `@${user}@${instance}`,
  };
}

// Inside detectSource(), BEFORE the HN block we just added:
const mAt = input.match(MASTODON_AT_RE);
if (mAt) return buildMastodonDetection(mAt[2].toLowerCase(), mAt[1]);

const mUserUrl = input.match(MASTODON_USER_URL_RE);
if (mUserUrl) return buildMastodonDetection(mUserUrl[1].toLowerCase(), mUserUrl[2]);

const mUsersUrl = input.match(MASTODON_USERS_URL_RE);
if (mUsersUrl) return buildMastodonDetection(mUsersUrl[1].toLowerCase(), mUsersUrl[2]);

if (MASTODON_TAGS_URL_RE.test(input)) {
  return {
    error: 'Mastodon hashtag feeds aren\'t supported yet — paste a user URL like https://mastodon.social/@user instead.',
  };
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts`
Expected: all tests pass (14 + 5 = 19).

Watch out: the Mastodon `MASTODON_USER_URL_RE` could match `news.ycombinator.com/@something` if someone constructs such a URL — but HN doesn't expose `@user` paths and the HN check runs after, so the ordering above (Mastodon before HN) is correct. Verify the HN tests still pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-detect.ts src/lib/__tests__/source-detect.test.ts
git commit -m "feat(source-detect): recognize Mastodon user URLs and @user@instance"
```

---

## Task 4: Add Bluesky detection

Bluesky author URLs look like `https://bsky.app/profile/<handle>`. The handle can be a domain handle (`taylor.bsky.social`) or a custom domain (`taylor.com`). Store the bsky.app profile URL as the canonical `feeds.url`; the poller resolves handle → DID at poll-time.

**Files:**
- Modify: `src/lib/source-detect.ts`
- Modify: `src/lib/__tests__/source-detect.test.ts`

- [ ] **Step 1: Write failing tests for Bluesky detection**

Append:

```ts
describe('detectSource — Bluesky', () => {
  it('detects a bsky.app profile URL', () => {
    expect(detectSource('https://bsky.app/profile/taylor.bsky.social')).toEqual({
      type: 'bluesky',
      url: 'https://bsky.app/profile/taylor.bsky.social',
      displayLabel: '@taylor.bsky.social',
    });
  });

  it('detects a custom-domain handle URL', () => {
    expect(detectSource('https://bsky.app/profile/jay.bsky.team')).toMatchObject({
      type: 'bluesky',
      displayLabel: '@jay.bsky.team',
    });
  });

  it('detects an @handle shorthand', () => {
    expect(detectSource('@taylor.bsky.social')).toMatchObject({
      type: 'bluesky',
      url: 'https://bsky.app/profile/taylor.bsky.social',
    });
  });

  it('does NOT collide with Mastodon @user@instance form', () => {
    // Two-part fediverse form should stay Mastodon
    expect(detectSource('@gargron@mastodon.social')).toMatchObject({ type: 'mastodon' });
  });
});
```

- [ ] **Step 2: Run the new tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts -t "Bluesky"`
Expected: 3 tests fail (the fourth, "does NOT collide", already passes).

- [ ] **Step 3: Add Bluesky patterns**

In `src/lib/source-detect.ts`:

```ts
// Regexes:
const BSKY_URL_RE = /^https?:\/\/bsky\.app\/profile\/([a-z0-9.-]+)\/?$/i;
const BSKY_HANDLE_RE = /^@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;  // single-@ + at least one dot

// Inside detectSource(), BEFORE the Mastodon block:
const bskyUrl = input.match(BSKY_URL_RE);
if (bskyUrl) {
  const handle = bskyUrl[1].toLowerCase();
  return {
    type: 'bluesky',
    url: `https://bsky.app/profile/${handle}`,
    displayLabel: `@${handle}`,
  };
}

const bskyAt = input.match(BSKY_HANDLE_RE);
if (bskyAt && !MASTODON_AT_RE.test(input)) {
  const handle = bskyAt[1].toLowerCase();
  return {
    type: 'bluesky',
    url: `https://bsky.app/profile/${handle}`,
    displayLabel: `@${handle}`,
  };
}
```

The `!MASTODON_AT_RE.test(input)` guard prevents the Bluesky branch from claiming `@user@instance` — that form has two `@` signs and matches Mastodon's regex.

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts`
Expected: all 23 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-detect.ts src/lib/__tests__/source-detect.test.ts
git commit -m "feat(source-detect): recognize bsky.app profile URLs and @handles"
```

---

## Task 5: Extend poll-feeds.ts to include Mastodon and HN

Mastodon and HN are RSS-shaped — the existing `poll-feeds.ts` already does conditional GET, dedup, and scrape. Only the SQL filter needs to learn about them.

**Files:**
- Modify: `src/cron/poll-feeds.ts`

- [ ] **Step 1: Update the source_type filter**

In `src/cron/poll-feeds.ts`, locate the feeds query (around line 30-41) and change:

```ts
// FROM:
AND source_type IN ('rss', 'substack')

// TO:
AND source_type IN ('rss', 'substack', 'mastodon', 'hn')
```

Also update the inline comment above the query block — currently it says "Reddit and YouTube have their own pollers ... RSS and Substack share this RSS pipeline." Append: "Mastodon (per-user .rss endpoints) and HN (front-page .rss) also flow through here."

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: all tests pass. No new test for this change — it's a one-token SQL change with no logic; correctness is verified end-to-end in Task 13.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cron/poll-feeds.ts
git commit -m "feat(poll-feeds): include mastodon and hn source types"
```

---

## Task 6: Fixture-based regression tests for feed-parser (Mastodon + HN)

The M1 exit criterion requires one fixture per new source type. Bluesky's fixture lives with the Bluesky helper (Task 8). Mastodon and HN both flow through the shared `src/lib/feed-parser.ts`, which currently has zero tests — adding fixture-driven tests here both satisfies the exit criterion and creates regression coverage for the parser everything depends on.

**Files:**
- Create: `src/lib/__tests__/feed-parser.test.ts`
- Create: `src/lib/__tests__/fixtures/mastodon-user-feed.xml`
- Create: `src/lib/__tests__/fixtures/hn-front-page.xml`

- [ ] **Step 1: Capture Mastodon fixture**

Save a real (hand-trimmed) Mastodon user RSS to `src/lib/__tests__/fixtures/mastodon-user-feed.xml`. Mastodon's `.rss` endpoint returns RSS 2.0 with `media:thumbnail`. A minimal viable fixture:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:webfeeds="http://webfeeds.org/rss/1.0">
  <channel>
    <title>molly0xfff (@molly0xfff@hachyderm.io)</title>
    <description>Public posts from @molly0xfff@hachyderm.io</description>
    <link>https://hachyderm.io/@molly0xfff</link>
    <webfeeds:icon>https://hachyderm.io/system/accounts/avatars/000.png</webfeeds:icon>
    <item>
      <guid isPermaLink="true">https://hachyderm.io/@molly0xfff/111111111111111111</guid>
      <link>https://hachyderm.io/@molly0xfff/111111111111111111</link>
      <pubDate>Mon, 11 May 2026 14:32:00 +0000</pubDate>
      <description>&lt;p&gt;A sample Mastodon post body with HTML markup.&lt;/p&gt;</description>
    </item>
    <item>
      <guid isPermaLink="true">https://hachyderm.io/@molly0xfff/111111111111111112</guid>
      <link>https://hachyderm.io/@molly0xfff/111111111111111112</link>
      <pubDate>Mon, 11 May 2026 15:00:00 +0000</pubDate>
      <description>&lt;p&gt;A second post with &lt;a href="https://example.com"&gt;a link&lt;/a&gt;.&lt;/p&gt;</description>
      <media:thumbnail url="https://files.hachyderm.io/media_attachments/files/000/000/001/small/thumb.jpg" />
    </item>
  </channel>
</rss>
```

- [ ] **Step 2: Capture HN fixture**

Save Hacker News front-page RSS to `src/lib/__tests__/fixtures/hn-front-page.xml`. HN uses RSS 2.0 with a `comments` element pointing at the discussion thread. Minimal fixture:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Hacker News</title>
    <link>https://news.ycombinator.com/</link>
    <description>Links for the intellectually curious, ranked by readers.</description>
    <item>
      <title>Show HN: Something cool</title>
      <link>https://example.com/cool-thing</link>
      <pubDate>Mon, 11 May 2026 12:00:00 +0000</pubDate>
      <comments>https://news.ycombinator.com/item?id=99999999</comments>
      <description>&lt;a href="https://news.ycombinator.com/item?id=99999999"&gt;Comments&lt;/a&gt;</description>
    </item>
    <item>
      <title>An interesting article about RSS</title>
      <link>https://blog.example.org/rss-is-cool</link>
      <pubDate>Mon, 11 May 2026 13:30:00 +0000</pubDate>
      <comments>https://news.ycombinator.com/item?id=99999998</comments>
      <description>&lt;a href="https://news.ycombinator.com/item?id=99999998"&gt;Comments&lt;/a&gt;</description>
    </item>
  </channel>
</rss>
```

- [ ] **Step 3: Write failing tests**

```ts
// src/lib/__tests__/feed-parser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFeed } from '../feed-parser';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const mastodonXml = readFileSync(join(fixturesDir, 'mastodon-user-feed.xml'), 'utf8');
const hnXml = readFileSync(join(fixturesDir, 'hn-front-page.xml'), 'utf8');

describe('parseFeed — Mastodon user RSS', () => {
  it('parses the channel title', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.title).toContain('molly0xfff');
  });

  it('extracts both items', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.items).toHaveLength(2);
  });

  it('extracts URL, guid, and publication time per item', () => {
    const parsed = parseFeed(mastodonXml);
    const first = parsed.items[0];
    expect(first.url).toBe('https://hachyderm.io/@molly0xfff/111111111111111111');
    expect(first.guid).toBeTruthy();
    expect(first.publishedAt).toBe(Date.parse('Mon, 11 May 2026 14:32:00 +0000'));
  });

  it('extracts HTML body from <description>', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.items[0].contentHtml).toContain('sample Mastodon post');
    expect(parsed.items[0].contentText).toContain('sample Mastodon post');
  });

  it('extracts media:thumbnail when present', () => {
    const parsed = parseFeed(mastodonXml);
    expect(parsed.items[1].imageUrl).toMatch(/thumb\.jpg$/);
  });
});

describe('parseFeed — Hacker News front page', () => {
  it('parses the channel title', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.title).toBe('Hacker News');
  });

  it('extracts items with title and link', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].title).toBe('Show HN: Something cool');
    expect(parsed.items[0].url).toBe('https://example.com/cool-thing');
  });

  it('extracts publication time', () => {
    const parsed = parseFeed(hnXml);
    expect(parsed.items[0].publishedAt).toBe(
      Date.parse('Mon, 11 May 2026 12:00:00 +0000'),
    );
  });
});
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/feed-parser.test.ts`
Expected: all 8 tests pass against the current `feed-parser.ts`. If any fail, that's a real bug in the parser surfaced by Mastodon/HN — fix the parser, do NOT fudge the fixture.

If a test fails due to a parser limitation that's intentional (e.g., `media:thumbnail` extraction logic that doesn't recognize a specific shape), document it in the test (e.g., `it.skip(...)`) and open a follow-up — but only after confirming with code review.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/__tests__/feed-parser.test.ts src/lib/__tests__/fixtures/mastodon-user-feed.xml src/lib/__tests__/fixtures/hn-front-page.xml
git commit -m "test(feed-parser): fixture-based coverage via Mastodon and HN samples"
```

---

## Task 7: Bluesky pure helpers — AT-URI conversion

ATProto post URIs look like `at://did:plc:abc.../app.bsky.feed.post/3kl...`. For our `canonical_url` we want the public bsky.app URL: `https://bsky.app/profile/<handle>/post/<rkey>`. The handle resolution needs context (the author handle is in the post payload), so this helper takes both.

**Files:**
- Create: `src/lib/bluesky.ts`
- Create: `src/lib/__tests__/bluesky.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/bluesky.test.ts
import { describe, it, expect } from 'vitest';
import { atUriToBskyUrl } from '../bluesky';

describe('atUriToBskyUrl', () => {
  it('converts a post AT-URI to a bsky.app profile post URL', () => {
    const uri = 'at://did:plc:abc123/app.bsky.feed.post/3klabcxyz';
    expect(atUriToBskyUrl(uri, 'taylor.bsky.social')).toBe(
      'https://bsky.app/profile/taylor.bsky.social/post/3klabcxyz',
    );
  });

  it('returns null for non-post AT-URIs', () => {
    expect(atUriToBskyUrl('at://did:plc:abc/app.bsky.feed.like/3k', 'h')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(atUriToBskyUrl('not-an-at-uri', 'h')).toBeNull();
    expect(atUriToBskyUrl('', 'h')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/bluesky.test.ts`
Expected: tests fail with "Cannot find module '../bluesky'".

- [ ] **Step 3: Create the lib file with the helper**

```ts
// src/lib/bluesky.ts
// Pure helpers for the Bluesky / ATProto poller. Designed to be testable
// without network or DB.

const AT_POST_RE = /^at:\/\/(did:[a-z0-9:_.-]+)\/app\.bsky\.feed\.post\/([a-z0-9]+)$/i;

/**
 * Convert an ATProto post URI to its public bsky.app URL.
 * Returns null for non-post URIs (likes, follows, etc.) or malformed input.
 */
export function atUriToBskyUrl(atUri: string, authorHandle: string): string | null {
  const m = atUri.match(AT_POST_RE);
  if (!m) return null;
  const [, , rkey] = m;
  return `https://bsky.app/profile/${authorHandle}/post/${rkey}`;
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/bluesky.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bluesky.ts src/lib/__tests__/bluesky.test.ts
git commit -m "feat(bluesky): atUriToBskyUrl helper for canonical post URLs"
```

---

## Task 8: Bluesky pure helpers — parse author-feed response

The ATProto `getAuthorFeed` response wraps each post in a `FeedViewPost`. We extract the shape we need (uri, indexedAt, text, author handle, embed image, reply/repost markers) into a normalized record per post. Reposts are skipped — they're authored by someone else.

**Files:**
- Modify: `src/lib/bluesky.ts`
- Modify: `src/lib/__tests__/bluesky.test.ts`
- Create: `src/lib/__tests__/fixtures/bluesky-author-feed.json`

- [ ] **Step 1: Capture a fixture**

Create `src/lib/__tests__/fixtures/bluesky-author-feed.json` with a hand-trimmed sample of `app.bsky.feed.getAuthorFeed` response covering: a normal post, a repost, a reply, and a post with an image embed.

```json
{
  "feed": [
    {
      "post": {
        "uri": "at://did:plc:author1/app.bsky.feed.post/3klpost1",
        "cid": "bafycid1",
        "author": { "did": "did:plc:author1", "handle": "alice.bsky.social", "displayName": "Alice" },
        "record": {
          "$type": "app.bsky.feed.post",
          "text": "Hello Bluesky from the test fixture.",
          "createdAt": "2026-05-01T12:00:00.000Z"
        },
        "indexedAt": "2026-05-01T12:00:01.000Z",
        "replyCount": 0, "repostCount": 1, "likeCount": 3
      }
    },
    {
      "post": {
        "uri": "at://did:plc:other/app.bsky.feed.post/3klrepost",
        "cid": "bafycid2",
        "author": { "did": "did:plc:other", "handle": "bob.bsky.social", "displayName": "Bob" },
        "record": { "$type": "app.bsky.feed.post", "text": "A post Bob wrote.", "createdAt": "2026-04-30T10:00:00.000Z" },
        "indexedAt": "2026-04-30T10:00:01.000Z"
      },
      "reason": {
        "$type": "app.bsky.feed.defs#reasonRepost",
        "by": { "did": "did:plc:author1", "handle": "alice.bsky.social" },
        "indexedAt": "2026-05-01T08:00:00.000Z"
      }
    },
    {
      "post": {
        "uri": "at://did:plc:author1/app.bsky.feed.post/3klreply",
        "cid": "bafycid3",
        "author": { "did": "did:plc:author1", "handle": "alice.bsky.social", "displayName": "Alice" },
        "record": {
          "$type": "app.bsky.feed.post",
          "text": "Reply text here.",
          "createdAt": "2026-05-01T13:00:00.000Z",
          "reply": { "root": { "uri": "at://did:plc:x/app.bsky.feed.post/3root" }, "parent": { "uri": "at://did:plc:x/app.bsky.feed.post/3parent" } }
        },
        "indexedAt": "2026-05-01T13:00:01.000Z"
      }
    },
    {
      "post": {
        "uri": "at://did:plc:author1/app.bsky.feed.post/3klimage",
        "cid": "bafycid4",
        "author": { "did": "did:plc:author1", "handle": "alice.bsky.social", "displayName": "Alice" },
        "record": {
          "$type": "app.bsky.feed.post",
          "text": "Post with an image.",
          "createdAt": "2026-05-01T14:00:00.000Z",
          "embed": {
            "$type": "app.bsky.embed.images",
            "images": [{ "alt": "test", "image": { "ref": { "$link": "bafyimg" }, "mimeType": "image/jpeg", "size": 1234 } }]
          }
        },
        "embed": {
          "$type": "app.bsky.embed.images#view",
          "images": [{ "thumb": "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:author1/bafyimg@jpeg", "fullsize": "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:author1/bafyimg@jpeg", "alt": "test" }]
        },
        "indexedAt": "2026-05-01T14:00:01.000Z"
      }
    }
  ]
}
```

- [ ] **Step 2: Write failing tests**

Append to `src/lib/__tests__/bluesky.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAuthorFeed } from '../bluesky';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const sampleFeed = JSON.parse(readFileSync(join(fixturesDir, 'bluesky-author-feed.json'), 'utf8'));

describe('parseAuthorFeed', () => {
  it('returns one record per non-repost post', () => {
    const out = parseAuthorFeed(sampleFeed);
    expect(out).toHaveLength(3); // skip the repost
  });

  it('skips reposts (authored by someone else)', () => {
    const out = parseAuthorFeed(sampleFeed);
    expect(out.find((p) => p.uri.includes('3klrepost'))).toBeUndefined();
  });

  it('extracts canonical URL, text, author handle, createdAt', () => {
    const out = parseAuthorFeed(sampleFeed);
    const first = out.find((p) => p.uri.includes('3klpost1'))!;
    expect(first.canonicalUrl).toBe('https://bsky.app/profile/alice.bsky.social/post/3klpost1');
    expect(first.text).toBe('Hello Bluesky from the test fixture.');
    expect(first.authorHandle).toBe('alice.bsky.social');
    expect(first.publishedAt).toBe(Date.parse('2026-05-01T12:00:00.000Z'));
  });

  it('captures image embed thumbnail URL when present', () => {
    const out = parseAuthorFeed(sampleFeed);
    const withImg = out.find((p) => p.uri.includes('3klimage'))!;
    expect(withImg.imageUrl).toMatch(/^https:\/\/cdn\.bsky\.app\/img\/feed_thumbnail\//);
  });

  it('flags replies', () => {
    const out = parseAuthorFeed(sampleFeed);
    const reply = out.find((p) => p.uri.includes('3klreply'))!;
    expect(reply.isReply).toBe(true);
  });

  it('returns empty array for missing or malformed feed', () => {
    expect(parseAuthorFeed({})).toEqual([]);
    expect(parseAuthorFeed({ feed: null })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/bluesky.test.ts -t "parseAuthorFeed"`
Expected: tests fail with "parseAuthorFeed is not a function".

- [ ] **Step 4: Implement parseAuthorFeed in src/lib/bluesky.ts**

Append:

```ts
export interface BlueskyPost {
  uri: string;
  canonicalUrl: string;
  text: string;
  authorHandle: string;
  authorDisplayName: string | null;
  publishedAt: number;
  imageUrl: string | null;
  isReply: boolean;
  raw: { replyCount?: number; repostCount?: number; likeCount?: number };
}

interface RawFeedView {
  post?: {
    uri?: string;
    author?: { handle?: string; displayName?: string };
    record?: {
      text?: string;
      createdAt?: string;
      reply?: unknown;
    };
    embed?: {
      $type?: string;
      images?: Array<{ thumb?: string }>;
    };
    replyCount?: number;
    repostCount?: number;
    likeCount?: number;
  };
  reason?: { $type?: string };
}

interface RawAuthorFeed {
  feed?: RawFeedView[] | null;
}

/**
 * Parse an app.bsky.feed.getAuthorFeed response into normalized post records.
 * Skips reposts (the `reason` field marks them; they're authored by someone
 * else and would clutter the user's library with content from accounts they
 * don't follow on the NebularNews side).
 */
export function parseAuthorFeed(raw: unknown): BlueskyPost[] {
  const feed = (raw as RawAuthorFeed)?.feed;
  if (!Array.isArray(feed)) return [];

  const out: BlueskyPost[] = [];
  for (const item of feed) {
    if (item.reason) continue;                 // skip reposts
    const post = item.post;
    if (!post || !post.uri || !post.author?.handle) continue;
    const text = post.record?.text ?? '';
    const createdAt = post.record?.createdAt;
    if (!createdAt) continue;

    const canonical = atUriToBskyUrl(post.uri, post.author.handle);
    if (!canonical) continue;

    out.push({
      uri: post.uri,
      canonicalUrl: canonical,
      text,
      authorHandle: post.author.handle,
      authorDisplayName: post.author.displayName ?? null,
      publishedAt: Date.parse(createdAt),
      imageUrl: post.embed?.images?.[0]?.thumb ?? null,
      isReply: Boolean(post.record?.reply),
      raw: {
        replyCount: post.replyCount,
        repostCount: post.repostCount,
        likeCount: post.likeCount,
      },
    });
  }
  return out;
}
```

- [ ] **Step 5: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/bluesky.test.ts`
Expected: all tests pass (3 from Task 7 + 6 = 9).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bluesky.ts src/lib/__tests__/bluesky.test.ts src/lib/__tests__/fixtures/bluesky-author-feed.json
git commit -m "feat(bluesky): parseAuthorFeed with fixture-based tests"
```

---

## Task 9: Bluesky handle → DID resolver

ATProto's `getAuthorFeed` accepts either a handle or a DID as the `actor` query parameter. Handles work directly, so for M1 we keep this trivial — no caching, no DID resolution, just pass the handle through. The function exists as a seam for later: when handles change, swap in DID-based fetching here without touching the poller.

**Files:**
- Modify: `src/lib/bluesky.ts`
- Modify: `src/lib/__tests__/bluesky.test.ts`

- [ ] **Step 1: Write failing test for URL builder**

Append:

```ts
import { authorFeedUrl } from '../bluesky';

describe('authorFeedUrl', () => {
  it('builds the public ATProto endpoint URL for a handle', () => {
    expect(authorFeedUrl('alice.bsky.social', 30)).toBe(
      'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=alice.bsky.social&limit=30',
    );
  });

  it('clamps limit between 1 and 100 (ATProto max)', () => {
    expect(authorFeedUrl('a', 0)).toMatch(/limit=1$/);
    expect(authorFeedUrl('a', 9999)).toMatch(/limit=100$/);
  });
});
```

- [ ] **Step 2: Run test; verify it fails**

Run: `npx vitest run src/lib/__tests__/bluesky.test.ts -t "authorFeedUrl"`
Expected: fails — `authorFeedUrl` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/bluesky.ts`:

```ts
const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

/**
 * Build the public unauthenticated ATProto endpoint URL for an author's
 * feed. `actor` accepts handle or DID; we pass the handle for now and let
 * the server resolve it. Limit is clamped to 1–100 (ATProto's hard max).
 */
export function authorFeedUrl(actor: string, limit: number): string {
  const clamped = Math.max(1, Math.min(100, Math.floor(limit)));
  return `${BSKY_PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${clamped}`;
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/bluesky.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bluesky.ts src/lib/__tests__/bluesky.test.ts
git commit -m "feat(bluesky): authorFeedUrl helper for ATProto endpoint"
```

---

## Task 10: Implement poll-bluesky.ts cron handler

Mirror `poll-reddit.ts` structurally — same fetch + parse + upsert + record-pull-run shape. Differences: ATProto endpoint, parse via `parseAuthorFeed`, store handle in `feeds.url`.

**Files:**
- Create: `src/cron/poll-bluesky.ts`

- [ ] **Step 1: Create the poller**

```ts
// src/cron/poll-bluesky.ts
import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbGet, dbRun } from '../db/helpers';
import { authorFeedUrl, parseAuthorFeed } from '../lib/bluesky';

// Cron sibling to pollFeeds / pollReddit. Polls subscribed Bluesky author
// feeds via the public unauthenticated ATProto endpoint. Anonymous reads are
// rate-limited; back off on errors using the same exponential pattern.

const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface BlueskyFeed {
  id: string;
  url: string;            // canonical stored as 'https://bsky.app/profile/<handle>'
  error_count: number;
}

function handleFromStoredUrl(storedUrl: string): string | null {
  const m = storedUrl.match(/^https?:\/\/bsky\.app\/profile\/([a-z0-9.-]+)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

export async function pollBluesky(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const maxFeeds = parseInt(env.MAX_FEEDS_PER_POLL) || 8;
  const maxItemsPerFeed = 30;

  const feeds = await dbAll<BlueskyFeed>(
    db,
    `SELECT id, url, error_count
       FROM feeds
      WHERE disabled = 0
        AND source_type = 'bluesky'
        AND (next_poll_at IS NULL OR next_poll_at <= ?)
      ORDER BY next_poll_at ASC
      LIMIT ?`,
    [now, maxFeeds],
  );

  if (feeds.length === 0) return;

  let totalNew = 0;
  let totalErrors = 0;

  for (const feed of feeds) {
    try {
      const handle = handleFromStoredUrl(feed.url);
      if (!handle) throw new Error(`Invalid stored Bluesky URL: ${feed.url}`);

      const res = await fetch(authorFeedUrl(handle, maxItemsPerFeed), {
        headers: {
          'User-Agent': 'NebularNews/1.0 (MCP server; +https://nebularnews.com)',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const posts = parseAuthorFeed(json);

      for (const post of posts) {
        const existing = await dbGet<{ id: string }>(
          db,
          `SELECT id FROM articles WHERE source_type = 'bluesky' AND canonical_url = ?`,
          [post.canonicalUrl],
        );
        if (existing) {
          // Refresh engagement counters; cheap.
          await dbRun(
            db,
            `UPDATE articles SET source_data_json = ? WHERE id = ?`,
            [JSON.stringify(post.raw), existing.id],
          );
          continue;
        }

        const articleId = nanoid();
        const excerpt = post.text.slice(0, 300);
        const wordCount = post.text.split(/\s+/).filter(Boolean).length;

        await dbRun(
          db,
          `INSERT INTO articles
             (id, title, canonical_url, guid, author,
              content_text, excerpt, word_count, image_url,
              published_at, fetched_at, source_type, source_data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bluesky', ?)`,
          [
            articleId,
            // Bluesky posts have no titles; use a truncated text or a placeholder.
            post.text.length > 0 ? post.text.slice(0, 120) : '(no text)',
            post.canonicalUrl,
            post.uri,
            `@${post.authorHandle}`,
            post.text,
            excerpt,
            wordCount,
            post.imageUrl,
            post.publishedAt,
            now,
            JSON.stringify({ ...post.raw, isReply: post.isReply, handle: post.authorHandle }),
          ],
        );

        await dbRun(
          db,
          `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [nanoid(), articleId, feed.id, post.uri, post.publishedAt, now],
        );

        totalNew++;
      }

      await dbRun(
        db,
        `UPDATE feeds SET last_polled_at = ?, next_poll_at = ?, error_count = 0,
                          title = COALESCE(title, ?)
         WHERE id = ?`,
        [now, now + FIVE_MINUTES_MS, `@${handle}`, feed.id],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[poll-bluesky] Error polling ${feed.url}:`, errMsg);
      totalErrors++;
      const newErrorCount = (feed.error_count || 0) + 1;
      const backoffMs = Math.min(
        FIVE_MINUTES_MS * Math.pow(2, newErrorCount),
        24 * 60 * 60 * 1000,
      );
      await dbRun(
        db,
        `UPDATE feeds SET error_count = ?, next_poll_at = ?, last_scrape_error = ?
         WHERE id = ?`,
        [newErrorCount, now + backoffMs, errMsg.slice(0, 500), feed.id],
      );
    }
  }

  await dbRun(
    db,
    `INSERT INTO pull_runs (id, status, trigger, started_at, completed_at, stats_json, created_at, updated_at)
     VALUES (?, 'done', 'cron', ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      now,
      Date.now(),
      JSON.stringify({ source: 'bluesky', feeds_polled: feeds.length, articles_new: totalNew, errors: totalErrors }),
      now,
      now,
    ],
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: all 11+ tests pass; no new test for the orchestration function (helper functions inside `bluesky.ts` are already covered).

- [ ] **Step 4: Commit**

```bash
git add src/cron/poll-bluesky.ts
git commit -m "feat(cron): poll-bluesky author-feed poller via public ATProto"
```

---

## Task 11: Wire poll-bluesky into the cron dispatcher

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the import and dispatch**

In `src/index.ts`:

```ts
// Add to the imports at the top, alongside the other cron imports:
import { pollBluesky } from './cron/poll-bluesky';

// Inside the scheduled handler, in the `case '*/5 * * * *':` block, add:
ctx.waitUntil(run('poll-bluesky', () => pollBluesky(env)));
```

The case block should now have four `waitUntil` calls: poll-feeds, poll-reddit, poll-youtube, poll-bluesky.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(cron): dispatch poll-bluesky on the 5-minute cron"
```

---

## Task 12: Update CLAUDE.md

The architecture changed: new source types, a new poller, updated cron map. CLAUDE.md must reflect this for future Claude Code sessions.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Cron → handler table**

Find the table in `CLAUDE.md` under "Cron → handler mapping" and change the `*/5 * * * *` row from:

```
| `*/5 * * * *`   | `pollFeeds` + `pollReddit` + `pollYoutube` (parallel)  |
```

to:

```
| `*/5 * * * *`   | `pollFeeds` + `pollReddit` + `pollYoutube` + `pollBluesky` (parallel) |
```

- [ ] **Step 2: Update the ingestion-pipelines paragraph**

Find the "Ingestion pipelines" paragraph. Currently it says:

> `src/cron/poll-feeds.ts` handles `source_type IN ('rss', 'substack')` — …

Change to:

> `src/cron/poll-feeds.ts` handles `source_type IN ('rss', 'substack', 'mastodon', 'hn')` — all are RSS-shaped, so they share conditional-GET, ETag/Last-Modified, dedup-by-canonical-url, and optional scrape. Reddit and YouTube poll separately (Reddit JSON, YouTube Atom without ETag). Bluesky polls separately too via `poll-bluesky.ts` (ATProto JSON).

- [ ] **Step 3: Update the `source-detect.ts` paragraph**

Currently mentions four source types (RSS URL, `r/sub`, `UC…`, `*.substack.com`). Add Mastodon, HN, Bluesky to the list. Also note the source-type registry refactor target (~6 types) — we're now at 7.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record new source types and poll-bluesky in architecture map"
```

---

## Task 13: End-to-end manual verification

Code change is done. Now verify the user-visible outcome: subscribing to one of each source type works and articles flow through.

**Files:** (none — verification only)

- [ ] **Step 1: Run local dev**

Run: `npm run dev`
Wait for: `wrangler dev` to start on port 8787 (or 8788). Note the port.

- [ ] **Step 2: Sign in to obtain a Bearer token**

In a browser, hit `http://localhost:8787/api/auth/sign-in/social/apple` (or google) and complete sign-in. Open dev-tools, copy your session token. Or use a previously-saved one.

- [ ] **Step 3: Subscribe to a Hacker News feed**

```bash
TOKEN=<paste your bearer token>

curl -sS -X POST http://localhost:8787/api/feeds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"hn"}'
```

Expected response: `{"ok":true,"data":{"feed_id":"...","source_type":"hn",...}}`.

- [ ] **Step 4: Subscribe to a Mastodon user**

```bash
curl -sS -X POST http://localhost:8787/api/feeds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://hachyderm.io/@molly0xfff"}'
```

Expected: `source_type: "mastodon"`, URL normalized to `.rss`.

- [ ] **Step 5: Subscribe to a Bluesky author**

```bash
curl -sS -X POST http://localhost:8787/api/feeds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://bsky.app/profile/jay.bsky.team"}'
```

Expected: `source_type: "bluesky"`.

- [ ] **Step 6: Trigger a poll**

The 5-minute cron won't have fired yet locally. Either wait (up to 5 min) or trigger a manual poll. The simplest manual trigger is to invoke the schedule endpoint via wrangler:

```bash
# In a second terminal, while `npm run dev` is running:
curl -sS "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

(Wrangler's dev server exposes `__scheduled` for testing crons.)

Expected: 200 OK. Watch the `npm run dev` log for `[cron:poll-bluesky]`, `[cron:poll-feeds]` lines — no errors.

- [ ] **Step 7: Verify articles appeared**

```bash
curl -sS "http://localhost:8787/api/articles?limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.articles[] | {title, canonical_url}'
```

Expected: at least a few articles from each source. HN should have ~30 front-page entries; Mastodon ~20 recent posts; Bluesky ~30 author-feed posts.

- [ ] **Step 8: Verify via MCP add_feed**

Also confirm the MCP `add_feed` tool accepts the new sources. Easiest path: hit `/mcp` directly with a tools/call request:

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_feed","arguments":{"source":"https://news.ycombinator.com"}}}'
```

Expected: `result.content` indicating the feed already exists (we added it via HTTP in Step 3) or was created.

- [ ] **Step 9: Final commit (only if any debug/log noise was added during verification)**

If verification surfaced minor issues (e.g., a regex that should be tightened), fix them with TDD (add a test, then the fix) and commit normally. If nothing changed, skip this step.

---

## Out of scope (deferred to later milestones)

- Mastodon hashtag streams.
- HN tag-specific searches via Algolia.
- Bluesky custom feeds (algorithmic feeds, not author timelines).
- Bluesky reposts, replies threading, embed-rich content rendering.
- ATProto authenticated reads / private accounts.
- A unified "story-level dedup" across sources (M4).
- New MCP tools that surface source-type filters (M5/M6).

These are intentionally not in M1 — keeping the milestone tight produces a clean exit and proves the pattern before the heavier sources lean on it.
