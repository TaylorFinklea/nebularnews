# M3 — Email Newsletters (Design)

**Date:** 2026-05-17
**Milestone:** M3 of the 6-month roadmap
**Roadmap reference:** `docs/superpowers/specs/2026-05-15-roadmap-design.md` → Phase 1 → M3
**Operator:** Single user
**Outcome:** *"I can ingest the newsletter that just hit my inbox."*

---

## 1. Goals & non-goals

### Goal

Email newsletters become a first-class `source_type`. Forwarding (or auto-routing) a Stratechery / Money Stuff / Platformer email to a unique per-feed address produces a clean article in the library — title from Subject, author from From:, body extracted from HTML via Readability. TOFU sender filtering catches obvious address leaks.

### Non-goals

- **No backfill** of historical inbox content. Forward-only.
- **No multi-user inbox routing.** Single operator.
- **No reply tracking, threading, or list-management automation.**
- **No content-aware newsletter chrome stripping.** Readability is the only stripping layer. Per-source heuristics deferred until a real newsletter breaks.
- **No Cloudflare Email Routing DNS automation.** MX records, accepted domains, catch-all rules are operator setup in the Cloudflare dashboard. We document the steps but don't automate them.
- **No outbound email.** Send is not in scope.
- **No sender allowlist beyond TOFU.**
- **No attachments.** Silently dropped — only the HTML/text body becomes an article.
- **No forward-chain unwrapping.** If you forward a newsletter from your inbox to your nebularnews address, From: is YOU, not the newsletter. TOFU still works for personal use (your own address locks). Documented as a known limitation.
- **No cleanup of the dead `email_ingest_tokens` table** from migration 0007. Dead but harmless; future cleanup migration if needed.

---

## 2. Components & data flow

Five new pieces and three small extensions.

### A. Migration `0029_email_newsletters.sql`

```sql
-- M3 — email newsletter ingestion
ALTER TABLE feeds ADD COLUMN inbound_address TEXT;
ALTER TABLE feeds ADD COLUMN expected_sender TEXT;
CREATE UNIQUE INDEX idx_feeds_inbound_address
  ON feeds (inbound_address)
  WHERE inbound_address IS NOT NULL;
```

- `inbound_address` is the `nl-<token>@in.nebularnews.com` we generate. UNIQUE so two feeds can't collide. NULL for non-email feeds.
- `expected_sender` is the From: address locked in by TOFU on the first received email. NULL means "lock on next email."
- Partial UNIQUE index lets non-email rows skip the constraint.
- No new `articles` columns. We reuse `articles.quarantined_at` (from migration 0017) for sender-mismatch quarantine.

### B. Pure parser — new `src/lib/email-parser.ts`

```ts
export interface ParsedEmail {
  from: string;             // "Alice Smith <alice@example.com>"
  fromAddress: string;      // "alice@example.com" — lowercased, for TOFU
  subject: string;
  messageId: string | null; // from Message-Id header
  listId: string | null;    // from List-Id header (RFC 2919)
  htmlBody: string | null;
  textBody: string | null;
  archiveUrl: string | null; // "View in browser" link if present in HTML
}

export async function parseEmail(raw: ReadableStream): Promise<ParsedEmail>;
```

Wraps `postal-mime` (already in deps). Pure function — no DB or global state. Testable with checked-in `.eml` fixtures. The `archiveUrl` extraction is a simple regex over the HTML for the canonical "View in browser" / "View on web" link patterns most newsletter platforms use.

### C. Body extractor — new `src/lib/email-extract.ts`

```ts
export interface ExtractedBody {
  contentHtml: string;
  contentText: string;
  excerpt: string;
  wordCount: number;
  imageUrl: string | null;
}

export function extractEmailBody(html: string | null, text: string | null): ExtractedBody;
```

Runs HTML through `@mozilla/readability` + `linkedom` (already used by `src/lib/scraper.ts` — reuse the dependency and approach). Falls back to plain text if HTML is missing or Readability returns nothing useful. This split keeps `email-parser.ts` MIME-only and `email-extract.ts` HTML-only — both independently testable.

### D. Email entrypoint — new `src/email.ts`

The handler Cloudflare Email Routing dispatches to:

```ts
export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  // 1. Look up feed by To: address
  const feed = await dbGet(env.DB,
    `SELECT id, expected_sender FROM feeds
     WHERE inbound_address = ? AND disabled = 0`,
    [message.to.toLowerCase()],
  );
  if (!feed) {
    // No subscribed feed for this address — reject so Cloudflare bounces it.
    message.setReject('unknown-recipient');
    return;
  }

  // 2. Parse MIME
  const parsed = await parseEmail(message.raw);

  // 3. TOFU sender check
  const quarantined = shouldQuarantine(feed.expected_sender, parsed.fromAddress);
  if (!feed.expected_sender) {
    await dbRun(env.DB,
      `UPDATE feeds SET expected_sender = ? WHERE id = ?`,
      [parsed.fromAddress, feed.id],
    );
  }

  // 4. Extract body
  const body = extractEmailBody(parsed.htmlBody, parsed.textBody);

  // 5. Canonical URL: prefer Message-Id, fall back to content hash
  const canonicalUrl = emailCanonicalUrl(parsed.messageId, parsed.htmlBody ?? parsed.textBody ?? '');

  // 6. Dedup by (source_type, canonical_url)
  const existing = await dbGet(env.DB,
    `SELECT id FROM articles WHERE source_type = 'email_newsletter' AND canonical_url = ?`,
    [canonicalUrl],
  );
  if (existing) return; // already ingested

  // 7. INSERT article (with quarantined_at if TOFU mismatch) + article_sources
  await dbRun(env.DB, /* INSERT */);
  await dbRun(env.DB, /* INSERT article_sources */);
}
```

Pure helpers `shouldQuarantine(expected, actual)` and `emailCanonicalUrl(messageId, body)` are exported alongside `handleEmail` so they can be unit-tested without DB or network.

`src/index.ts` extends its default export:

```ts
export default {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => { /* existing */ },
  email: (msg, env, ctx) => handleEmail(msg, env),
};
```

### E. `add_feed` for email — extends `src/lib/source-detect.ts` and routes

`detectSource('email')` and `detectSource('newsletter')` return a sentinel value:

```ts
{ type: 'email_pending' as const }
```

The HTTP route `POST /api/feeds` and the MCP `add_feed` tool see `type: 'email_pending'`, generate the inbound address at the **route layer** (not in `detectSource` — keeping the detector pure of side effects), and:

1. Generate `inbound_address = 'nl-' + nanoid(16) + '@in.nebularnews.com'` (host configurable via env var `EMAIL_INBOUND_DOMAIN`, default `in.nebularnews.com`).
2. `INSERT INTO feeds (id, url, source_type, feed_type, inbound_address, expected_sender, title)` — `url` set to the inbound_address (canonical identifier); `source_type='email_newsletter'`; `feed_type='email_newsletter'` (matches existing column semantics); `title` left NULL until first email arrives.
3. Return the address in the response so the user can copy-paste it into their newsletter subscription form.

The MCP tool's `add_feed` description string is updated to mention email shorthand.

### Data flow (end-to-end)

```
1. User: add_feed("email")
   → route generates inbound_address = "nl-<nanoid16>@in.nebularnews.com"
   → INSERT feed (source_type='email_newsletter', feed_type='email_newsletter',
                  inbound_address=<addr>, expected_sender=NULL)
   → response: { feed_id, inbound_address }

2. User subscribes Stratechery to that address (one-time external action).

3. Email arrives → Cloudflare Email Routing → Worker email() handler
   → parseEmail(message.raw)
   → look up feed by message.to
   → if feed.expected_sender NULL: UPDATE expected_sender = parsed.fromAddress;
     article NOT quarantined
   → else if expected != parsed.fromAddress: article quarantined_at = now
   → extractEmailBody → INSERT articles + article_sources

4. MCP search_articles / get_recent surfaces it like any other article.
   Quarantined articles are filtered out of get_recent by the existing
   articles.quarantined_at IS NULL clause in src/routes/articles.ts.
```

---

## 3. Risks & known unknowns

- **Worker email-handler size limits.** `ForwardableEmailMessage.raw` is a stream; large attachments could spike memory. **Mitigation:** stream once through postal-mime; don't buffer the raw blob in DB or memory.
- **`postal-mime` Workers compatibility.** Library advertises Workers support but unverified in this codebase. **Mitigation:** parser is isolated to one file; swap to alternative (`mailparser`, `letter-opener`) is a one-file change if it doesn't work.
- **TOFU lock race.** Two emails arriving back-to-back into an empty `expected_sender` slot: both proceed as non-quarantined, second's lock overwrites first's. **Mitigation:** doesn't matter — both are within the trust horizon, first sender wins by lexical race but functionally identical to "either is acceptable."
- **Address leak.** Random 16-char token = unguessable. TOFU catches an attacker spoofing a different From:. If an attacker spoofs the legitimate sender on a leaked address, TOFU passes — accept this; user regenerates the address by deleting + re-adding the feed.
- **Operator DNS misconfiguration.** Email Routing not set up → emails bounce externally → silent from user's perspective. **Mitigation:** Task plan's verification step calls out the dashboard configuration explicitly.
- **No backfill of pre-M3 history.** Pre-M3 newsletters in the user's inbox stay there. Documented in goals; no automated import.
- **Forward-chain.** User forwards a newsletter from their own inbox to the nebularnews address — TOFU locks on the user's email, not the newsletter's. Works for personal use (you're the only sender). If you later want auto-routing instead of forwarding, you regenerate the feed.

---

## 4. Testing

- **`src/lib/__tests__/email-parser.test.ts`** — fixture-driven tests.
  - Fixture `substack-newsletter.eml` (a real captured Substack-shaped email, hand-trimmed for fixtures).
  - Fixture `plain-text-newsletter.eml` (no HTML body, edge case).
  - Tests: extracts From:, Subject:, Message-Id, List-Id, archiveUrl, HTML body, text body.
- **`src/lib/__tests__/email-extract.test.ts`** — pure-function tests over sample newsletter HTML.
  - Verifies Readability pulls main content, drops chrome footers, returns excerpt + word_count.
  - Verifies fallback to plain text when HTML is null.
- **`src/__tests__/email.test.ts`** — pure-helper tests for the email handler's exported helpers.
  - `shouldQuarantine(expected, actual)`: same address (case-insensitive) → false; different → true; expected null → false.
  - `emailCanonicalUrl(messageId, body)`: with Message-Id → `mid:<id>`; without → `mid:hash-<sha256-of-body>`; empty body fallback → still produces a unique value.
- **`source-detect.test.ts` extension** — one new test for `detectSource('email')` and `detectSource('newsletter')` returning `{ type: 'email_pending' }`.

The `handleEmail` orchestrator itself is not unit-tested (DB + ForwardableEmailMessage shape are hard to mock cleanly). End-to-end verification in the plan's final task covers it.

---

## 5. File structure

**Create:**
- `migrations/0029_email_newsletters.sql` — schema additions.
- `src/lib/email-parser.ts` — `parseEmail` + `ParsedEmail` type.
- `src/lib/__tests__/email-parser.test.ts` — fixture-driven tests.
- `src/lib/__tests__/fixtures/substack-newsletter.eml` — captured fixture.
- `src/lib/__tests__/fixtures/plain-text-newsletter.eml` — edge case fixture.
- `src/lib/email-extract.ts` — `extractEmailBody` + `ExtractedBody` type.
- `src/lib/__tests__/email-extract.test.ts` — Readability path tests.
- `src/email.ts` — `handleEmail`, `shouldQuarantine`, `emailCanonicalUrl`.
- `src/__tests__/email.test.ts` — pure-helper tests.

**Modify:**
- `src/index.ts` — add `email:` to default export.
- `src/lib/source-detect.ts` — recognize `'email'` and `'newsletter'` shortcuts; return `{ type: 'email_pending' }`.
- `src/lib/__tests__/source-detect.test.ts` — new test for the email shortcut.
- `src/routes/feeds.ts` — handle `type: 'email_pending'`; generate inbound_address; INSERT feed with email columns; return address in response.
- `src/mcp/tools.ts` — same handling in the `add_feed` tool dispatch; update description string to advertise email/newsletter shortcut.
- `src/env.ts` — add `EMAIL_INBOUND_DOMAIN?: string` (optional override; defaults to `in.nebularnews.com`).
- `CLAUDE.md` — update architecture map: new entrypoint `email()`, new feed columns, new source type `email_newsletter`.

---

## 6. Exit criteria

1. `add_feed("email")` (via `POST /api/feeds` AND MCP `add_feed` tool) returns `{ feed_id, inbound_address }` with a `nl-<token>@in.nebularnews.com`-shaped address.
2. Forwarding a real newsletter to the address produces an article in the library — title from Subject, author from From: (display name + email), body extracted via Readability.
3. The first email's From: address gets locked into `feeds.expected_sender`.
4. A second email from a *different* From: address creates an article but with `articles.quarantined_at` set; the article is hidden from `get_recent` by the existing quarantine filter.
5. Forwarding the *same* email twice doesn't duplicate (canonical URL dedup by Message-Id).
6. Email to an unknown inbound address is rejected by the handler (`message.setReject('unknown-recipient')`).
7. `src/lib/__tests__/email-parser.test.ts` passes against checked-in `.eml` fixtures.
8. Migration `0029` applies cleanly via `npm run migrate:local`.

---

## 7. Sequencing (informs the plan)

1. Migration `0029` first — schema before code.
2. `email-parser.ts` with fixtures + tests — pure parser, no dependencies on rest of M3.
3. `email-extract.ts` with tests — pure HTML→article transformer, no dependencies.
4. Email handler `src/email.ts` with helpers and helper tests — uses parser + extractor.
5. Wire `email:` into `src/index.ts` default export.
6. `detectSource('email')` + route layer changes for `add_feed`.
7. MCP `add_feed` description update.
8. CLAUDE.md docs.
9. Manual end-to-end verification (requires Cloudflare Email Routing setup).

---

## 8. Operator setup (one-time, outside code)

These are documented for the implementation plan's verification task; not automated.

1. Add `in.nebularnews.com` (or chosen subdomain) to the Cloudflare account.
2. Enable Email Routing on the zone.
3. Create a catch-all routing rule: any address at the subdomain → Worker.
4. Verify MX records auto-populate.
5. Send a test email to a known-bad address and confirm `setReject` bounces.
6. Send a test email to a real `nl-<token>@in.nebularnews.com` and confirm an article appears.

Set `EMAIL_INBOUND_DOMAIN=in.nebularnews.com` (or chosen subdomain) as a Worker environment variable in staging and production.

---

## 9. Open follow-ups (not in M3)

- Cleanup migration to drop the dead `email_ingest_tokens` table.
- Per-newsletter chrome stripping if Readability proves inadequate for a specific source.
- Inbound attachments (PDFs as separate articles? store as R2 blobs?).
- Inbound calendar invites (.ics) — could surface as event-shaped articles.
- A second source-type that uses the same email infrastructure (e.g., "send-to-archive" for personal note-taking).
- An admin endpoint to manually un-quarantine a TOFU mismatch (false positive).
- Optional DKIM/SPF override for self-hosted-domain edge cases.
