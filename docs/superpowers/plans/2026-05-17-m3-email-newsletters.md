# M3 — Email Newsletters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email newsletters become a first-class `source_type` — forwarding a newsletter to a unique per-feed address produces a clean article in the library, with TOFU sender filtering.

**Architecture:** A new Worker `email()` entrypoint dispatches received messages to `handleEmail`, which looks up the feed by To: address, parses the MIME via `postal-mime`, runs TOFU sender filtering, extracts the body via Readability (`src/lib/email-extract.ts`), and INSERTs an article. Per-feed inbound addresses are generated at `add_feed` time (route layer) as `nl-<nanoid16>@<EMAIL_INBOUND_DOMAIN>`. A new migration adds `feeds.inbound_address` (UNIQUE) and `feeds.expected_sender` (TOFU lock).

**Tech Stack:** Cloudflare Workers (email handler), Hono, D1, `postal-mime` (MIME parser, already in deps), `@mozilla/readability` + `linkedom` (already used by scraper), Vitest. No new npm dependencies.

---

## File Structure

**Create**
- `migrations/0029_email_newsletters.sql` — `feeds.inbound_address` (UNIQUE) + `feeds.expected_sender` (TOFU).
- `src/lib/email-parser.ts` — `parseEmail(raw): Promise<ParsedEmail>` wrapping postal-mime. Pure.
- `src/lib/__tests__/email-parser.test.ts` — fixture-driven tests.
- `src/lib/__tests__/fixtures/substack-newsletter.eml` — realistic Substack-shaped sample.
- `src/lib/__tests__/fixtures/plain-text-newsletter.eml` — plain-text-only edge case.
- `src/lib/email-extract.ts` — `extractEmailBody(html, text): ExtractedBody`. Pure.
- `src/lib/__tests__/email-extract.test.ts` — Readability path tests.
- `src/email.ts` — `handleEmail(msg, env)`, pure helpers `shouldQuarantine(expected, actual)` and `emailCanonicalUrl(messageId, body)`.
- `src/__tests__/email.test.ts` — pure-helper tests.

**Modify**
- `src/env.ts` — add `EMAIL_INBOUND_DOMAIN?: string`.
- `src/index.ts` — add `email:` to default export.
- `src/lib/source-detect.ts` — extend `SourceType` with `'email_newsletter'`; recognize `'email'` / `'newsletter'` shortcuts; return `{ type: 'email_newsletter', url: '', displayLabel: 'Email newsletter (pending address)' }`.
- `src/lib/__tests__/source-detect.test.ts` — tests for the email shortcut detection.
- `src/routes/feeds.ts` — when `detected.type === 'email_newsletter'` and `detected.url === ''`, generate `inbound_address` and INSERT with the email columns; return `inbound_address` in the response.
- `src/mcp/tools.ts` — same handling in the `add_feed` tool dispatch; update tool description string to advertise the email shortcut and explain the returned address.
- `CLAUDE.md` — update architecture map: new `email()` entrypoint, new feed columns, new source type `email_newsletter`.

Each file has one responsibility. The split mirrors the pattern from M2 (pure parser ↔ pure extractor ↔ orchestrator/handler) so future maintainers recognize the shape.

---

## Sequencing

1. Migration first — schema before code references new columns.
2. Pure parser (`email-parser.ts`) with fixtures + tests — no dependencies on the rest of M3.
3. Pure extractor (`email-extract.ts`) with tests — no dependencies.
4. Email handler `src/email.ts` — uses parser + extractor; pure helpers tested.
5. Wire `email:` into `src/index.ts` + add `EMAIL_INBOUND_DOMAIN` to env.
6. `detectSource` recognizes `'email'` / `'newsletter'` shortcuts.
7. Route + MCP handle the `email_newsletter` type — generate inbound_address, INSERT, return.
8. CLAUDE.md docs.
9. Manual end-to-end verification (requires Cloudflare Email Routing dashboard setup).

---

## Task 1: Migration 0029 — feeds.inbound_address + expected_sender

**Files:**
- Create: `migrations/0029_email_newsletters.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 0029 — Email newsletter ingestion
--
-- M3 of the 6-month roadmap. Adds per-feed inbound email addresses and
-- TOFU (trust-on-first-use) sender locking to the feeds table. No new
-- articles columns — sender-mismatch quarantine reuses articles.quarantined_at
-- from migration 0017.
--
-- The UNIQUE index on inbound_address is partial (only when NOT NULL) so
-- non-email feeds skip the constraint entirely.

ALTER TABLE feeds ADD COLUMN inbound_address TEXT;
ALTER TABLE feeds ADD COLUMN expected_sender TEXT;

CREATE UNIQUE INDEX idx_feeds_inbound_address
  ON feeds (inbound_address)
  WHERE inbound_address IS NOT NULL;
```

- [ ] **Step 2: Apply migration locally**

Run: `npm run migrate:local`
Expected: applies `0029_email_newsletters.sql` without error.

- [ ] **Step 3: Verify the new columns**

Run: `npx wrangler d1 execute DB --local --command "PRAGMA table_info(feeds);" 2>&1 | tail -30`
Expected: `inbound_address` and `expected_sender` columns visible.

- [ ] **Step 4: Verify the partial index**

Run: `npx wrangler d1 execute DB --local --command "SELECT name, sql FROM sqlite_master WHERE name = 'idx_feeds_inbound_address';"`
Expected: index returned with `WHERE inbound_address IS NOT NULL` in the SQL.

- [ ] **Step 5: Commit**

```bash
git add migrations/0029_email_newsletters.sql
git commit -m "feat(db): migration 0029 — feeds.inbound_address + expected_sender for M3"
```

Do NOT push.

---

## Task 2: Pure email parser with postal-mime + fixtures

`parseEmail` wraps `postal-mime` to extract structured fields. Pure function — no DB, no global state. Fixture-driven tests.

**Files:**
- Create: `src/lib/__tests__/fixtures/substack-newsletter.eml`
- Create: `src/lib/__tests__/fixtures/plain-text-newsletter.eml`
- Create: `src/lib/__tests__/email-parser.test.ts`
- Create: `src/lib/email-parser.ts`

- [ ] **Step 1: Capture the Substack-shaped fixture**

Save as `src/lib/__tests__/fixtures/substack-newsletter.eml` (note: lines end with `\r\n` per RFC 5322; use a real text file with CRLF — when writing via the `Write` tool, embed `\r\n` literally if needed, or write the file with normal newlines and let Git's autoCRLF handle it. If `postal-mime` rejects LF-only EMLs, switch to CRLF and re-save):

```
From: "Stratechery by Ben Thompson" <ben@stratechery.com>
To: nl-test@in.nebularnews.com
Subject: The aggregator paradox revisited
Message-ID: <stratechery-test-001@email.stratechery.com>
List-ID: "Stratechery" <stratechery.email.stratechery.com>
Date: Fri, 17 May 2026 09:00:00 +0000
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="boundary-stratechery"

--boundary-stratechery
Content-Type: text/plain; charset="UTF-8"

The Aggregator Paradox Revisited

View in browser: https://stratechery.com/2026/aggregator-paradox-revisited

Today I want to revisit a topic from years past. The aggregator paradox argues that platforms which start as neutral discovery layers eventually accrue power.

--boundary-stratechery
Content-Type: text/html; charset="UTF-8"

<html><body>
<h1>The Aggregator Paradox Revisited</h1>
<p><a href="https://stratechery.com/2026/aggregator-paradox-revisited">View in browser</a></p>
<p>Today I want to revisit a topic from years past. The aggregator paradox argues that platforms which start as neutral discovery layers eventually accrue power.</p>
<p>Three forces drive this convergence:</p>
<ul>
<li>Network effects make switching costly</li>
<li>Data accumulation creates moats</li>
<li>Platform owners can change the rules unilaterally</li>
</ul>
<p>The implication for new market entrants is significant.</p>
</body></html>

--boundary-stratechery--
```

- [ ] **Step 2: Capture the plain-text edge-case fixture**

Save as `src/lib/__tests__/fixtures/plain-text-newsletter.eml`:

```
From: "Plain Sender" <plain@example.com>
To: nl-test@in.nebularnews.com
Subject: Plain text only newsletter
Message-ID: <plain-test-001@example.com>
Date: Fri, 17 May 2026 10:00:00 +0000
MIME-Version: 1.0
Content-Type: text/plain; charset="UTF-8"

This newsletter has no HTML part.
Just plain text.
A second paragraph for word count.
```

- [ ] **Step 3: Write failing tests**

Create `src/lib/__tests__/email-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEmail } from '../email-parser';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureStream(name: string): ReadableStream {
  const buf = readFileSync(join(fixturesDir, name));
  return new Response(buf).body!;
}

describe('parseEmail — Substack-shaped newsletter', () => {
  it('extracts From: display name and address', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.from).toContain('Stratechery');
    expect(parsed.fromAddress).toBe('ben@stratechery.com');
  });

  it('extracts Subject', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.subject).toBe('The aggregator paradox revisited');
  });

  it('extracts Message-ID', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.messageId).toBe('stratechery-test-001@email.stratechery.com');
  });

  it('extracts List-ID', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.listId).toContain('stratechery.email.stratechery.com');
  });

  it('extracts HTML body', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.htmlBody).toContain('Aggregator Paradox');
  });

  it('extracts plain-text body', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.textBody).toContain('aggregator paradox');
  });

  it('extracts archive URL from HTML "View in browser" link', async () => {
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.archiveUrl).toBe('https://stratechery.com/2026/aggregator-paradox-revisited');
  });
});

describe('parseEmail — plain-text-only newsletter', () => {
  it('extracts From: and Subject', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.fromAddress).toBe('plain@example.com');
    expect(parsed.subject).toBe('Plain text only newsletter');
  });

  it('htmlBody is null when no HTML part', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.htmlBody).toBeNull();
  });

  it('textBody is populated', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.textBody).toContain('no HTML part');
  });

  it('archiveUrl is null when no link found', async () => {
    const parsed = await parseEmail(fixtureStream('plain-text-newsletter.eml'));
    expect(parsed.archiveUrl).toBeNull();
  });
});

describe('parseEmail — defensive', () => {
  it('normalizes fromAddress to lowercase', async () => {
    // Fixture has lowercase already; this is a documented invariant.
    const parsed = await parseEmail(fixtureStream('substack-newsletter.eml'));
    expect(parsed.fromAddress).toBe(parsed.fromAddress.toLowerCase());
  });
});
```

- [ ] **Step 4: Run tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/email-parser.test.ts`
Expected: 12 tests fail with "Cannot find module '../email-parser'".

- [ ] **Step 5: Implement `parseEmail`**

Create `src/lib/email-parser.ts`:

```ts
import PostalMime from 'postal-mime';

// MIME parser wrapper. Pure function: takes a raw email stream, returns the
// structured fields the email handler needs. No DB, no global state. Uses
// postal-mime (already in deps), which is Workers-compatible. If the lib
// ever rejects Workers, swap to mailparser or letter-opener here — the
// callers only depend on the ParsedEmail shape.

export interface ParsedEmail {
  from: string;             // "Display Name <addr@example.com>" or just "addr@example.com"
  fromAddress: string;      // "addr@example.com" — lowercased, used for TOFU comparison
  subject: string;
  messageId: string | null; // unwrapped (no angle brackets)
  listId: string | null;    // List-Id header value, raw
  htmlBody: string | null;
  textBody: string | null;
  archiveUrl: string | null; // "View in browser"/"View on web" link if found in HTML
}

const ARCHIVE_LINK_RE = /<a[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>[^<]*(?:view\s+(?:in|on)\s+(?:browser|web)|view\s+online|read\s+in\s+browser)[^<]*<\/a>/i;

function extractArchiveUrl(html: string | null): string | null {
  if (!html) return null;
  const m = html.match(ARCHIVE_LINK_RE);
  return m ? m[1] : null;
}

export async function parseEmail(raw: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<ParsedEmail> {
  const parser = new PostalMime();
  const email = await parser.parse(raw as Parameters<typeof parser.parse>[0]);

  const fromName = email.from?.name ?? '';
  const fromAddrRaw = email.from?.address ?? '';
  const fromAddress = fromAddrRaw.trim().toLowerCase();
  const fromDisplay = fromName ? `${fromName} <${fromAddrRaw}>` : fromAddrRaw;

  // postal-mime exposes messageId with angle brackets sometimes; strip them.
  const messageIdRaw = email.messageId ?? null;
  const messageId = messageIdRaw ? messageIdRaw.replace(/^<|>$/g, '') : null;

  const listIdHeader = email.headers?.find((h) => h.key.toLowerCase() === 'list-id')?.value ?? null;

  const htmlBody = email.html ?? null;
  const textBody = email.text ?? null;

  return {
    from: fromDisplay,
    fromAddress,
    subject: email.subject ?? '',
    messageId,
    listId: listIdHeader,
    htmlBody,
    textBody,
    archiveUrl: extractArchiveUrl(htmlBody),
  };
}
```

- [ ] **Step 6: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/email-parser.test.ts`
Expected: 12 tests pass. If any fails because of EML line-ending issues (LF-only vs CRLF), re-save the fixture file with CRLF line endings and retry.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/email-parser.ts src/lib/__tests__/email-parser.test.ts src/lib/__tests__/fixtures/substack-newsletter.eml src/lib/__tests__/fixtures/plain-text-newsletter.eml
git commit -m "feat(email-parser): postal-mime wrapper with fixture tests"
```

Do NOT push.

---

## Task 3: Pure email body extractor

`extractEmailBody` runs HTML through Readability (via linkedom, like `src/lib/scraper.ts`), with plain-text fallback. Pure function.

**Files:**
- Create: `src/lib/__tests__/email-extract.test.ts`
- Create: `src/lib/email-extract.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/email-extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractEmailBody } from '../email-extract';

const SAMPLE_HTML = `
<html><body>
<h1>The Aggregator Paradox Revisited</h1>
<p><a href="https://example.com/archive">View in browser</a></p>
<p>Today I want to revisit a topic from years past. The aggregator paradox argues that platforms which start as neutral discovery layers eventually accrue power.</p>
<p>Three forces drive this convergence: network effects, data accumulation, and unilateral rule changes.</p>
</body></html>
`;

describe('extractEmailBody', () => {
  it('extracts main content from HTML via Readability', () => {
    const result = extractEmailBody(SAMPLE_HTML, null);
    expect(result.contentText).toContain('aggregator paradox');
    expect(result.contentText).toContain('Three forces');
    expect(result.wordCount).toBeGreaterThan(10);
  });

  it('produces an excerpt of at most 300 chars', () => {
    const result = extractEmailBody(SAMPLE_HTML, null);
    expect(result.excerpt.length).toBeLessThanOrEqual(300);
    expect(result.excerpt.length).toBeGreaterThan(0);
  });

  it('falls back to plain text when html is null', () => {
    const result = extractEmailBody(null, 'Plain text body\nSecond line');
    expect(result.contentText).toContain('Plain text body');
    expect(result.contentHtml).toBe('');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('falls back to plain text when html produces no readable content', () => {
    // Empty/structureless HTML
    const result = extractEmailBody('<html><body></body></html>', 'Plain fallback');
    expect(result.contentText).toContain('Plain fallback');
  });

  it('returns empty body when both html and text are null', () => {
    const result = extractEmailBody(null, null);
    expect(result.contentText).toBe('');
    expect(result.contentHtml).toBe('');
    expect(result.wordCount).toBe(0);
    expect(result.excerpt).toBe('');
    expect(result.imageUrl).toBeNull();
  });

  it('extracts first image URL when present in HTML', () => {
    const htmlWithImage = `
      <html><body>
      <h1>Title</h1>
      <img src="https://cdn.example.com/hero.jpg" alt="Hero">
      <p>Body content.</p>
      </body></html>
    `;
    const result = extractEmailBody(htmlWithImage, null);
    expect(result.imageUrl).toBe('https://cdn.example.com/hero.jpg');
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/lib/__tests__/email-extract.test.ts`
Expected: 6 tests fail — module not found.

- [ ] **Step 3: Implement `extractEmailBody`**

Create `src/lib/email-extract.ts`:

```ts
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

// Pure HTML→article body extractor for email newsletters. Reuses the same
// Readability + linkedom approach src/lib/scraper.ts uses for web pages.
// Falls back to plain text when HTML is missing or Readability returns
// nothing usable.

export interface ExtractedBody {
  contentHtml: string;
  contentText: string;
  excerpt: string;
  wordCount: number;
  imageUrl: string | null;
}

const EMPTY: ExtractedBody = {
  contentHtml: '',
  contentText: '',
  excerpt: '',
  wordCount: 0,
  imageUrl: null,
};

function firstImageFromHtml(html: string): string | null {
  const m = html.match(/<img[^>]*\bsrc="(https?:\/\/[^"]+)"/i);
  return m ? m[1] : null;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function plainTextFallback(text: string): ExtractedBody {
  const cleaned = text.trim();
  if (cleaned.length === 0) return EMPTY;
  return {
    contentHtml: '',
    contentText: cleaned,
    excerpt: cleaned.slice(0, 300),
    wordCount: countWords(cleaned),
    imageUrl: null,
  };
}

export function extractEmailBody(html: string | null, text: string | null): ExtractedBody {
  // No content at all.
  if (!html && !text) return EMPTY;

  // No HTML: just clean text.
  if (!html) return plainTextFallback(text!);

  // Try Readability.
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();
    if (article && article.textContent && article.textContent.trim().length > 0) {
      const contentText = article.textContent.trim();
      const contentHtml = article.content ?? html;
      return {
        contentHtml,
        contentText,
        excerpt: contentText.slice(0, 300),
        wordCount: countWords(contentText),
        imageUrl: firstImageFromHtml(html),
      };
    }
  } catch {
    // Readability threw — fall through to text fallback if available.
  }

  // Readability produced nothing usable: fall back to text if we have it.
  if (text && text.trim().length > 0) return plainTextFallback(text);

  // Last resort: strip tags crudely from the HTML.
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    contentHtml: html,
    contentText: stripped,
    excerpt: stripped.slice(0, 300),
    wordCount: countWords(stripped),
    imageUrl: firstImageFromHtml(html),
  };
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/email-extract.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/email-extract.ts src/lib/__tests__/email-extract.test.ts
git commit -m "feat(email-extract): Readability-based body extractor with text fallback"
```

Do NOT push.

---

## Task 4: Email handler with pure helpers

`src/email.ts` exports the orchestrator (`handleEmail`) and two pure helpers (`shouldQuarantine`, `emailCanonicalUrl`). Only the helpers get unit-tested; the orchestrator's DB+stream interaction is exercised end-to-end in Task 9.

**Files:**
- Create: `src/__tests__/email.test.ts`
- Create: `src/email.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `src/__tests__/email.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldQuarantine, emailCanonicalUrl } from '../email';

describe('shouldQuarantine', () => {
  it('returns false when expected is null (TOFU lock pending)', () => {
    expect(shouldQuarantine(null, 'sender@example.com')).toBe(false);
  });

  it('returns false when expected matches actual', () => {
    expect(shouldQuarantine('sender@example.com', 'sender@example.com')).toBe(false);
  });

  it('returns false when comparison is case-insensitive', () => {
    expect(shouldQuarantine('Sender@Example.COM', 'sender@example.com')).toBe(false);
    expect(shouldQuarantine('sender@example.com', 'Sender@Example.COM')).toBe(false);
  });

  it('returns true when expected differs from actual', () => {
    expect(shouldQuarantine('alice@example.com', 'bob@example.com')).toBe(true);
  });

  it('returns true when actual is empty but expected is set', () => {
    expect(shouldQuarantine('alice@example.com', '')).toBe(true);
  });
});

describe('emailCanonicalUrl', () => {
  it('returns mid:<id> when Message-Id is provided', async () => {
    const url = await emailCanonicalUrl('abc-123@example.com', 'body content');
    expect(url).toBe('mid:abc-123@example.com');
  });

  it('hashes body when Message-Id is null', async () => {
    const url = await emailCanonicalUrl(null, 'some body content');
    expect(url).toMatch(/^mid:hash-[a-f0-9]{16,}$/);
  });

  it('produces stable hashes for identical bodies', async () => {
    const a = await emailCanonicalUrl(null, 'identical body');
    const b = await emailCanonicalUrl(null, 'identical body');
    expect(a).toBe(b);
  });

  it('produces different hashes for different bodies', async () => {
    const a = await emailCanonicalUrl(null, 'body one');
    const b = await emailCanonicalUrl(null, 'body two');
    expect(a).not.toBe(b);
  });

  it('handles empty body when no Message-Id', async () => {
    const url = await emailCanonicalUrl(null, '');
    expect(url).toMatch(/^mid:hash-[a-f0-9]{16,}$/);
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/__tests__/email.test.ts`
Expected: 10 tests fail — module not found.

- [ ] **Step 3: Implement `src/email.ts`**

Create `src/email.ts`:

```ts
import { nanoid } from 'nanoid';
import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import type { Env } from './env';
import { dbGet, dbRun } from './db/helpers';
import { parseEmail } from './lib/email-parser';
import { extractEmailBody } from './lib/email-extract';

// Cloudflare Email Routing dispatches received messages to this handler.
// We look up the feed by To: address, parse the MIME, run TOFU sender
// filtering, extract the body via Readability, and INSERT an article.
// Unknown recipient → reject (Cloudflare bounces). Parse failure → still
// INSERT a metadata-only article so the email isn't lost.

interface FeedRow {
  id: string;
  expected_sender: string | null;
}

/**
 * TOFU sender check. Returns true if the article should be quarantined
 * (sender doesn't match the expected one). Returns false when:
 *   - expected is null (no TOFU lock yet — first email through)
 *   - expected matches actual (case-insensitive)
 */
export function shouldQuarantine(expected: string | null, actual: string): boolean {
  if (expected === null) return false;
  return expected.toLowerCase() !== actual.toLowerCase();
}

/**
 * Build a canonical URL for an email article. Prefers Message-Id (always
 * unique, present on virtually every modern email); falls back to a hash
 * of the body when Message-Id is missing.
 */
export async function emailCanonicalUrl(messageId: string | null, body: string): Promise<string> {
  if (messageId) return `mid:${messageId}`;
  const bytes = new TextEncoder().encode(body);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // 16 hex chars (64 bits) is plenty for dedup at personal scale.
  return `mid:hash-${hashHex.slice(0, 16)}`;
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();

  // 1. Look up feed by recipient address. Cloudflare gives To: lowercased already.
  const feed = await dbGet<FeedRow>(
    db,
    `SELECT id, expected_sender FROM feeds
       WHERE inbound_address = ? AND disabled = 0`,
    [message.to],
  );
  if (!feed) {
    message.setReject('unknown-recipient');
    return;
  }

  // 2. Parse MIME.
  let parsed;
  try {
    parsed = await parseEmail(message.raw);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[email] parse failed for feed ${feed.id}:`, errMsg);
    // Don't reject — log and bail. Caller (Cloudflare) won't bounce.
    return;
  }

  // 3. TOFU sender check.
  const quarantined = shouldQuarantine(feed.expected_sender, parsed.fromAddress);
  if (!feed.expected_sender && parsed.fromAddress) {
    await dbRun(
      db,
      `UPDATE feeds SET expected_sender = ? WHERE id = ?`,
      [parsed.fromAddress, feed.id],
    );
  }

  // 4. Extract body.
  const body = extractEmailBody(parsed.htmlBody, parsed.textBody);

  // 5. Build canonical URL (Message-Id preferred, hash fallback).
  const canonicalUrl = await emailCanonicalUrl(parsed.messageId, body.contentText);

  // 6. Dedup.
  const existing = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM articles WHERE source_type = 'email_newsletter' AND canonical_url = ?`,
    [canonicalUrl],
  );
  if (existing) return;

  // 7. INSERT.
  const articleId = nanoid();
  await dbRun(
    db,
    `INSERT INTO articles
       (id, title, canonical_url, guid, author,
        content_html, content_text, excerpt, word_count, image_url,
        published_at, fetched_at, source_type, source_data_json,
        quarantined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email_newsletter', ?, ?)`,
    [
      articleId,
      parsed.subject || '(no subject)',
      canonicalUrl,
      parsed.messageId ?? canonicalUrl,
      parsed.from || parsed.fromAddress || '(unknown sender)',
      body.contentHtml,
      body.contentText,
      body.excerpt,
      body.wordCount,
      body.imageUrl,
      now,                                              // published_at: when we received it
      now,
      JSON.stringify({
        from_address: parsed.fromAddress,
        list_id: parsed.listId,
        archive_url: parsed.archiveUrl,
        quarantined_reason: quarantined ? 'sender_mismatch' : null,
      }),
      quarantined ? now : null,
    ],
  );

  await dbRun(
    db,
    `INSERT OR IGNORE INTO article_sources (id, article_id, feed_id, item_guid, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nanoid(), articleId, feed.id, parsed.messageId ?? canonicalUrl, now, now],
  );

  // Update feed metadata: title from first email's List-Id or subject.
  await dbRun(
    db,
    `UPDATE feeds SET last_polled_at = ?,
                      title = COALESCE(title, ?)
       WHERE id = ?`,
    [now, parsed.listId ?? parsed.from, feed.id],
  );
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/__tests__/email.test.ts`
Expected: 10 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/email.ts src/__tests__/email.test.ts
git commit -m "feat(email): handleEmail orchestrator + TOFU and canonical-url helpers"
```

Do NOT push.

---

## Task 5: Wire `email:` into the Worker default export + env var

**Files:**
- Modify: `src/env.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `EMAIL_INBOUND_DOMAIN` to the Env interface**

In `src/env.ts`, find the Env interface and add:

```ts
// Email Routing — inbound newsletter address domain. Configured per-environment.
EMAIL_INBOUND_DOMAIN?: string;
```

Place it near other config vars (alongside `APP_ENV`, `MAX_FEEDS_PER_POLL`).

- [ ] **Step 2: Wire `handleEmail` into the default export**

In `src/index.ts`:

Add to the imports block:

```ts
import { handleEmail } from './email';
```

Add to the `export default { fetch, scheduled }` block at the bottom — extend with `email`:

```ts
export default {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    /* existing scheduled handler stays unchanged */
  },
  email: async (
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> => {
    try {
      await handleEmail(message, env);
    } catch (err) {
      console.error('[email-entrypoint]', err);
    }
  },
};
```

Don't forget the type imports — at the top, alongside `ScheduledEvent`/`ExecutionContext`:

```ts
import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
```

(Or rely on the global if `@cloudflare/workers-types` exposes it globally — verify with `npm run typecheck` after.)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: all tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/index.ts
git commit -m "feat(email): wire email entrypoint into Worker default export"
```

Do NOT push.

---

## Task 6: `detectSource` recognizes the email shortcut

**Files:**
- Modify: `src/lib/source-detect.ts`
- Modify: `src/lib/__tests__/source-detect.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/__tests__/source-detect.test.ts`:

```ts
describe('detectSource — email shortcut', () => {
  it('recognizes "email" shortcut', async () => {
    expect(await detectSource('email')).toEqual({
      type: 'email_newsletter',
      url: '',
      displayLabel: 'Email newsletter (pending address)',
    });
  });

  it('recognizes "newsletter" shortcut (case-insensitive)', async () => {
    expect(await detectSource('Newsletter')).toMatchObject({
      type: 'email_newsletter',
      url: '',
    });
  });

  it('recognizes "EMAIL" all-caps', async () => {
    expect(await detectSource('EMAIL')).toMatchObject({ type: 'email_newsletter' });
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts -t "email shortcut"`
Expected: 3 tests fail (current code falls through to "Unrecognized source" error).

- [ ] **Step 3: Update source-detect.ts**

In `src/lib/source-detect.ts`:

1. Extend the `SourceType` union to include `'email_newsletter'`:

```ts
export type SourceType = 'rss' | 'reddit' | 'youtube' | 'substack' | 'hn' | 'mastodon' | 'bluesky' | 'email_newsletter';
```

2. Inside `detectSource()`, AFTER the empty-input check and BEFORE all other branches, add:

```ts
const lower = input.toLowerCase();
if (lower === 'email' || lower === 'newsletter') {
  return {
    type: 'email_newsletter',
    url: '',
    displayLabel: 'Email newsletter (pending address)',
  };
}
```

The empty `url` is the sentinel the route layer uses to know to generate an inbound_address.

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts`
Expected: all source-detect tests pass (existing + 3 new). Run the full test suite to confirm no regressions: `npm run test`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-detect.ts src/lib/__tests__/source-detect.test.ts
git commit -m "feat(source-detect): recognize 'email' and 'newsletter' shortcuts"
```

Do NOT push.

---

## Task 7: Route + MCP — email feed creation

When `detectSource` returns `{ type: 'email_newsletter', url: '' }`, the route layer generates the inbound_address, INSERTs the feed, and returns the address. Both `POST /api/feeds` and the MCP `add_feed` tool need to handle this.

**Files:**
- Modify: `src/routes/feeds.ts`
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Update `POST /api/feeds`**

In `src/routes/feeds.ts`, find the existing handler for `POST /feeds`. The relevant section is where `detectSource(rawInput)` is called and the result is processed.

Add a helper near the top of the file (or inline in the handler — your call):

```ts
function generateInboundAddress(env: { EMAIL_INBOUND_DOMAIN?: string }): string {
  const domain = env.EMAIL_INBOUND_DOMAIN || 'in.nebularnews.com';
  return `nl-${nanoid(16)}@${domain}`;
}
```

After `const detected = await detectSource(rawInput);` and the existing `'error' in detected` branch, add the email-feed branch BEFORE the standard INSERT logic:

```ts
if (detected.type === 'email_newsletter' && detected.url === '') {
  const userId = c.get('userId');
  const feedId = nanoid();
  const inboundAddress = generateInboundAddress(c.env).toLowerCase();
  const now = Date.now();

  await dbRun(
    c.env.DB,
    `INSERT INTO feeds (id, url, source_type, feed_type, inbound_address, scrape_mode, last_polled_at, next_poll_at)
     VALUES (?, ?, 'email_newsletter', 'email_newsletter', ?, 'rss_only', NULL, NULL)`,
    [feedId, inboundAddress, inboundAddress],
  );
  await dbRun(
    c.env.DB,
    `INSERT INTO user_feed_subscriptions (user_id, feed_id, created_at)
     VALUES (?, ?, ?)`,
    [userId, feedId, now],
  );

  return c.json({
    ok: true,
    data: {
      feed_id: feedId,
      source_type: 'email_newsletter',
      inbound_address: inboundAddress,
      instructions: `Subscribe your newsletter to ${inboundAddress}. We'll lock the first sender on its first email (trust-on-first-use).`,
    },
  });
}
```

Notes:
- The feed's `url` column is set to the inbound address (it's the canonical identifier — matches Substack's pattern of using the URL as the unique key).
- `scrape_mode='rss_only'` matches the pre-existing default and is benign for email feeds (no scrape ever happens).
- The route schema for user subscriptions matches the existing pattern (see other branches in this file).

Check what the existing INSERT pattern looks like before this branch — confirm `user_feed_subscriptions` is the right join table. If the existing code uses a different table or shape, mirror it exactly.

- [ ] **Step 2: Update MCP `add_feed` tool**

In `src/mcp/tools.ts`:

(a) Find the `add_feed` tool's description string. It currently lists all the source types (RSS, Substack, Reddit, etc., and after M2 includes HN/Mastodon/Bluesky/YouTube @handle). Add email to the list:

```
... or 'email' / 'newsletter' (returns a unique inbound address you can subscribe your newsletter to).
```

(b) Find the `add_feed` handler inside `handleToolCall`. After `const detected = await detectSource(source);` and the existing error branch, add the email-feed branch:

```ts
if (detected.type === 'email_newsletter' && detected.url === '') {
  const feedId = nanoid();
  const domain = (db as unknown as { EMAIL_INBOUND_DOMAIN?: string }).EMAIL_INBOUND_DOMAIN || 'in.nebularnews.com';
  // Note: the MCP tool only has `db` access here, not full env. The env
  // var has to be threaded through if we want it dynamic; for now use the
  // hardcoded default which matches the route layer.
  const inboundAddress = `nl-${nanoid(16)}@${domain}`.toLowerCase();
  const now = Date.now();

  await dbRun(
    db,
    `INSERT INTO feeds (id, url, source_type, feed_type, inbound_address, scrape_mode, last_polled_at, next_poll_at)
     VALUES (?, ?, 'email_newsletter', 'email_newsletter', ?, 'rss_only', NULL, NULL)`,
    [feedId, inboundAddress, inboundAddress],
  );
  await dbRun(
    db,
    `INSERT INTO user_feed_subscriptions (user_id, feed_id, created_at)
     VALUES (?, ?, ?)`,
    [userId, feedId, now],
  );

  return {
    content: [{
      type: 'text',
      text: `Created email-newsletter feed. Subscribe your newsletter to: ${inboundAddress}\n\nThe first email's From: address will be locked as the expected sender (trust-on-first-use). Later emails from a different sender will be quarantined.`,
    }],
  };
}
```

If `tools.ts` has access to the full `env` (some MCP tool handlers do), use `env.EMAIL_INBOUND_DOMAIN` instead of hardcoding. Check the surrounding code to see what's available.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: all tests pass — the additions don't break any existing test.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/feeds.ts src/mcp/tools.ts
git commit -m "feat(email): add_feed via HTTP route and MCP tool"
```

Do NOT push.

---

## Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the request-layering diagram or section that lists Worker entrypoints**

Add `email()` to the Worker entrypoint discussion. Find the section that describes `fetch` and `scheduled` and add a third line. Example:

> The Worker exports three entrypoints: `fetch` (Hono app), `scheduled` (cron handler), and `email` (Cloudflare Email Routing → `handleEmail` in `src/email.ts`).

- [ ] **Step 2: Update the source-types paragraph**

Find the `src/lib/source-detect.ts` description (which now lists 7 source types post-M2). Add `email`/`newsletter` as the 8th:

> ... `email` or `newsletter` shorthand (Email newsletter — returns a unique `nl-<token>@<domain>` inbound address; first email's From: gets locked as expected_sender via TOFU).

Update the registry-refactor note to reflect that we're now at 8 source types — the threshold is crossed; add a note that a registry refactor is now appropriate the next time `source-detect.ts` is touched.

- [ ] **Step 3: Update the data-access / schema section**

If CLAUDE.md mentions schema highlights (migrations 0017 for quarantine, 0027 for source_type, 0028 for transcripts), add 0029:

> Migration `0029_email_newsletters.sql` adds `feeds.inbound_address` (UNIQUE-on-not-null) and `feeds.expected_sender` (TOFU lock).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record email() entrypoint, email_newsletter source type, migration 0029"
```

Do NOT push.

---

## Task 9: End-to-end manual verification

The automated checks can verify code and unit tests; only manual verification can validate the Cloudflare Email Routing pipeline end-to-end.

**Files:** (none — verification only)

- [ ] **Step 1: Configure Cloudflare Email Routing**

In the Cloudflare dashboard for your account:
1. Add the chosen inbound subdomain (e.g., `in.nebularnews.com`) — either as a new zone or as a record on an existing zone.
2. Enable Email Routing on the zone.
3. Verify MX records auto-populate (Email Routing adds them).
4. Create a routing rule: catch-all on `*@in.nebularnews.com` → Worker `nebular-news` (or whichever Worker the production env uses).
5. Set the env variable `EMAIL_INBOUND_DOMAIN=in.nebularnews.com` via `npx wrangler secret put EMAIL_INBOUND_DOMAIN --env production` (or via dashboard vars).

If you're verifying locally (not against production):
- Cloudflare Email Routing does not run against `wrangler dev`. Local verification is limited to confirming the handler dispatches correctly via mocking, or deploying to a staging environment first.
- Recommended: deploy to staging, set `EMAIL_INBOUND_DOMAIN=<staging-subdomain>`, run verification there.

- [ ] **Step 2: Deploy to staging**

Run: `npm run migrate:staging && npm run deploy:staging`
Expected: deploy succeeds. `/api/health` returns 200.

- [ ] **Step 3: Create an email feed via the HTTP API**

Sign in to obtain a Bearer token (same flow as M1/M2 verification). Then:

```bash
TOKEN=<paste your bearer token>
STAGING=<your staging base URL>

curl -sS -X POST "$STAGING/api/feeds" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"email"}'
```

Expected response shape:

```json
{
  "ok": true,
  "data": {
    "feed_id": "...",
    "source_type": "email_newsletter",
    "inbound_address": "nl-<16chars>@in.nebularnews.com",
    "instructions": "Subscribe your newsletter to nl-..."
  }
}
```

- [ ] **Step 4: Send a test email to the address**

From your real email client (Gmail, etc.), compose and send a test email TO the `inbound_address` returned above. Subject and body of your choice.

- [ ] **Step 5: Verify the article appeared**

Wait ~10-30 seconds (Cloudflare Email Routing has some delivery latency). Then:

```bash
curl -sS "$STAGING/api/articles?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.articles[] | {title, author, word_count, canonical_url}'
```

Expected: the most recent article has your test email's subject as title, your sender's address as author, and `canonical_url` starts with `mid:`.

- [ ] **Step 6: Verify TOFU lock**

Query the feeds table to confirm `expected_sender` was set:

```bash
npx wrangler d1 execute DB --env staging --command "SELECT id, inbound_address, expected_sender FROM feeds WHERE source_type='email_newsletter' ORDER BY id DESC LIMIT 1;"
```

Expected: `expected_sender` is your sender address (lowercased).

- [ ] **Step 7: Send from a DIFFERENT sender, verify quarantine**

Send another email from a different address (e.g., an alternate account) to the same `inbound_address`. After a moment:

```bash
curl -sS "$STAGING/api/articles?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.articles[] | {title, canonical_url}'
```

Expected: the new article should NOT appear in the result (the route filters `quarantined_at IS NULL`). Verify it WAS inserted but quarantined:

```bash
npx wrangler d1 execute DB --env staging --command "SELECT title, quarantined_at, source_data_json FROM articles WHERE source_type='email_newsletter' ORDER BY fetched_at DESC LIMIT 3;"
```

Expected: the second email is present with non-null `quarantined_at` and `source_data_json` containing `"quarantined_reason":"sender_mismatch"`.

- [ ] **Step 8: Send an email to an unknown address, verify rejection**

Send an email to `nl-bogus-doesnotexist@in.nebularnews.com`. Cloudflare should bounce it back (or the Worker should `setReject`). Verify no article was created.

- [ ] **Step 9: Verify dedup**

Forward the same email twice (use your email client's forward function, or send identical mail). After both arrive:

```bash
npx wrangler d1 execute DB --env staging --command "SELECT COUNT(*) FROM articles WHERE source_type='email_newsletter' AND canonical_url LIKE 'mid:%';"
```

Expected: count reflects unique emails only, not the duplicates.

- [ ] **Step 10: Final commit (only if any debug fixes were made)**

If verification surfaced bugs, fix them TDD-style. Otherwise skip.

---

## Out of scope (deferred to later milestones)

- Cleanup migration to drop the dead `email_ingest_tokens` table from migration 0007.
- Per-newsletter chrome stripping heuristics (Substack-specific footer cleanup, etc.).
- Inbound attachments (PDFs, images as separate articles or R2 blobs).
- Inbound calendar invites (.ics) as event-shaped articles.
- Forward-chain unwrapping (detecting "user forwarded this to us — original sender was Y").
- Admin endpoint to un-quarantine a TOFU mismatch (false positive).
- Optional DKIM/SPF override for edge cases.
- Outbound email (send).
- A registry refactor for `source-detect.ts` (now at 8 source types, threshold crossed — first task to touch this file post-M3 should consider it).
