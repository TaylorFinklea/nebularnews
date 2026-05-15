# NebularNews — 6-Month Roadmap

**Date:** 2026-05-15
**Horizon:** May 2026 → November 2026
**Operator:** Single user (Taylor)
**Direction (from brainstorm):** Deepen MCP. Source coverage is the primary pain. Outcomes-first sequencing.

This is a **roadmap**, not an implementation spec. Each milestone below will get its own brainstorm → spec → plan cycle before code is written.

---

## 1. Goals & non-goals

### Goals

- **Coverage** — ingest the high-signal sources currently locked out: email newsletters, social feeds (Bluesky / Mastodon / HN), YouTube videos with transcripts.
- **Intelligence on top of coverage** — once multi-source ingestion is real, the LLM's view must scale with it: story-level dedup, read-state awareness, slicing by time/source/freshness.
- **Tool-surface parity with the web admin** — Claude should be able to curate (bookmark, tag, archive, subscribe, unsubscribe, configure scraping, inspect feed health) without opening the admin UI. Endgame: admin web is optional, not load-bearing.
- **Single user, single operator.** Every decision optimizes for "is it useful daily?", not "does it scale to 1,000 users?"

### Non-goals

- No multi-user / tenancy / billing work.
- No second client integrations (ChatGPT, Claude Desktop, custom GPTs). They'll likely work once the MCP surface is rich, but they're not roadmap items.
- No on-device AI / no in-house summarization / no in-house ranking-by-LLM. The LLM lives in Claude; the server stays a retrieval + curation engine. Migration `0025_drop_ai_tables` was deliberate — keep it that way.
- No iOS / native app revival.
- No new auth providers (Apple + Google is enough).
- No public hosting / sharing surface.

---

## 2. The six outcomes, sequenced

Two phases. **Coverage** (M1–M3) gets the sources in. **Intelligence** (M4–M6) makes the now-larger library usable.

### Phase 1 — Coverage

#### M1 · "I can ask Claude what's on my Bluesky / Mastodon feed today." (~Month 1)

**Outcome.** Social feeds become subscribable sources. Bluesky author feeds, Mastodon user/hashtag feeds, and Hacker News (front page + tag-specific) all flow into the article store through the existing MCP retrieval surface.

**Sketch of work.**
- `source-detect.ts`: add patterns for `bsky.app/profile/<handle>`, `mastodon.social/@user` (and arbitrary instances), and `news.ycombinator.com` shorthands.
- Mastodon + HN are RSS-shaped — likely just first-class detection plus a normalize step; reuses `poll-feeds.ts` for `source_type IN ('rss', ...)`.
- Bluesky needs a new poller (`src/cron/poll-bluesky.ts`) using ATProto's public feed endpoints — sibling to `poll-reddit.ts`. JSON shape, not RSS.
- `wrangler.toml` cron stays at `*/5 * * * *`; `index.ts` `scheduled()` dispatches the new poller alongside the existing three.

**Why first.** Cheapest of the three new sources. Stress-tests the multi-poller pattern PR #5 introduced before the harder sources lean on it.

**Exit criteria.**
- All three subscribable via `add_feed` (MCP tool) and `POST /api/feeds` (HTTP).
- Polling runs on the 5-min cron; articles appear in `get_recent` / `search_articles`.
- One known-good fixture per source type checked in under `src/cron/__tests__/fixtures/`.

---

#### M2 · "I can give Claude a YouTube video and it knows what's in it." (~Month 2)

**Outcome.** YouTube `@handle` URLs are accepted (today: rejected — `source-detect.ts:46`). New videos land with a transcript in `content_text`, so `search_articles` and `get_article` work over video content.

**Sketch of work.**
- `@handle` → channel-ID resolver in `source-detect.ts` (single fetch of the channel page or YouTube oEmbed).
- New `src/lib/transcript.ts` — provider interface (`fetchTranscript(videoId): Promise<TranscriptSegments | null>`). One provider to start (likely `youtube-transcript-api` shape over the captions endpoint, or a third-party service if Workers-incompatible).
- `poll-youtube.ts` calls the transcript subsystem after upserting the article; persists segments concatenated into `content_text`, segment timing optional column.
- Migration adds nullable transcript columns (segments JSON, language).

**Reusability.** The transcript subsystem is designed as a generic interface, not a YouTube-specific module — podcasts, recorded talks, etc. become low-cost adds later. Don't over-design the interface up front; let M2's single use case shape it, refactor when the second use case arrives.

**Exit criteria.**
- `add_feed` accepts `https://youtube.com/@handle` and `https://youtube.com/@handle/videos`.
- Videos with captions: transcript present in `content_text`, searchable.
- Videos without captions: ingested as metadata-only article, no error. `last_fetch_error` records the reason.

---

#### M3 · "I can ingest the newsletter that just hit my inbox." (~Month 3)

**Outcome.** Email newsletters become a first-class `source_type`. A unique inbound address per newsletter feed lets the user forward (or auto-route) Stratechery, Platformer, Money Stuff, etc. into the library.

**Sketch of work.**
- Cloudflare Email Routing → Worker email handler. Adds `email()` to the Worker entrypoint alongside `fetch()` and `scheduled()`.
- Per-feed unique inbound address (e.g., `<feed-id>@in.nebularnews.com` or vanity slug). Stored on the `feeds` row.
- `postal-mime` parses the incoming MIME → HTML/text body → Readability for article extraction.
- Newsletter chrome stripping: unsubscribe footers, tracking pixels, list-management links. Probably heuristic, source-tuned over time.
- Revives the `email_newsletter` `feed_type` already in `poll-feeds.ts`'s exclusion clause and migration `0007_inbox_unification`.

**Why last in Phase 1.** Most new infra (MX setup, inbound handler, per-feed address routing), highest failure surface. Do it once the poller/ingestion patterns are proven.

**Exit criteria.**
- Forwarding a real newsletter to a unique address produces a clean article in the library — title, author (sender), body extracted, chrome stripped.
- `add_feed` with `source: 'email'` returns a unique inbound address to subscribe with.
- Bounces / spam / unsubscribed senders don't take down the handler.

---

### Phase 2 — Intelligence

#### M4 · "I can ask what changed since yesterday, with the same story from 4 sources collapsed into one." (~Month 4)

**Outcome.** Read-state awareness + story-level dedup. Tripled source coverage means duplicates — the LLM should see one item per story, with provenance, and should know what's new since the last query.

**Sketch of work.**
- Read-state pieces already exist (`reading_position` mig 0014, `time_spent_ms_total` 0023) but aren't MCP-exposed. Surface them through `get_recent` / new `get_unread` shape.
- Story-level dedup: cluster articles by canonical URL → fall back to title similarity → fall back to content hash similarity. Conservative thresholds first — under-merge is better than over-merge. Cluster ID on `articles`, primary article designated, siblings linkable.
- `get_recent` gains `since_last_call` mode (uses a per-user cursor stored server-side, not a client-tracked timestamp).
- Result shape: each item carries `also_seen_in: [{ feed_id, feed_title }]` when clustered.

**Exit criteria.**
- A scripted scenario where 4 sources cover the same story produces 1 result from `get_recent`, with all 4 sources visible.
- Two consecutive `get_recent` calls with `since_last_call: true` return non-overlapping sets.

---

#### M5 · "I can tell Claude to bookmark / tag / archive — without leaving the chat." (~Month 5)

**Outcome.** MCP write tools. Today's 6 tools are retrieval + feed CRUD; this adds curation: `tag_article`, `untag_article`, `archive_article`, `bookmark_article`.

**Sketch of work.**
- Tags + archive state already exist in schema (`article_tags`, `articles.quarantined_at` for one form of archive). New explicit `archived_at` column likely needed.
- The two-phase confirm-proposal pattern from migration `0020_tool_call_proposals` may apply for destructive writes — though for a single-user system it's probably overkill. Default to no confirm; revisit if accidents happen.
- Surface write tools through both MCP and the existing HTTP API where it makes sense (`POST /api/articles/:id/tags` etc.).

**Exit criteria.**
- All four write tools available through MCP. Idempotent (re-tagging the same tag is a no-op, etc.).
- Tags created on-the-fly when used (no separate "create tag" step required from the LLM).

---

#### M6 · "Claude is my admin surface — I don't open the web app." (~Month 6)

**Outcome.** Remaining admin operations as MCP tools so the web admin becomes optional.

**Sketch of work.**
- Per-feed configuration: `set_scrape_mode`, `set_paused`, `set_min_score`, `disable_feed`.
- Feed health inspection: `get_feed_health` (poll history, error counts, last successful poll, extraction quality avg).
- Manual re-poll: `repoll_feed` (triggers a single feed's poll out-of-cycle).
- Retention settings: `set_retention_window` / `get_retention_settings`.
- These call into the same code paths the admin HTTP routes already use — mostly thin MCP wrappers, not new logic.

**Exit criteria.**
- A new MCP user could subscribe, configure scraping, troubleshoot a broken feed, and re-poll it without ever logging into the admin UI.
- Admin web reduced to a status dashboard, not a control surface (or removed entirely — decision deferred to end of M6).

---

## 3. Cross-cutting platform work

Things built *because* of the milestones, not as separate milestones:

- **Poller abstraction.** Pollers are siblings today (`poll-feeds.ts`, `poll-reddit.ts`, `poll-youtube.ts`); M1 adds Bluesky, M3 adds email. Extract the common shape (`fetch → parse → upsert article → link source → record run`) once the pattern's clear — target the refactor during M2, with two pollers as the test case.
- **Transcript subsystem (M2).** Designed generically with a provider interface. Reused later for non-roadmap adds (podcasts, etc.) without re-architecture.
- **Source-type registry.** `source-detect.ts` will grow from 4 source types to ~7. Refactor to a `{ pattern, type, normalize() }` registry once it reaches ~6 entries — not before.
- **Test fixtures.** Two test files today. Each new source lands with at least one fixture under `src/**/__tests__/fixtures/`. Don't introduce `@cloudflare/vitest-pool-workers` unless a real reason emerges; pure-function unit tests over fixtures are sufficient.
- **Docs hygiene.** README is stale (already noted in CLAUDE.md). Overhaul once M3 ships — "what NebularNews is" is finally stable post-coverage. CLAUDE.md gets updated as architectural shape changes (the poller abstraction is a notable update trigger).

---

## 4. Risks & known unknowns

- **Email infra is the biggest unknown.** Cloudflare Email Routing → Worker handler has size and rate limits not yet verified. Per-feed unique-address generation has UX choices (vanity slug vs random hash). **Mitigation:** spike (1–2 days of exploration, no commitment) before M3 starts; M3 may slip if the spike reveals architectural blockers.
- **YouTube transcript availability is patchy.** Videos without captions need a graceful fallback (ingest metadata only, log reason). **Mitigation:** don't block article creation on transcript success — transcript is an enrichment, not a gate.
- **Story-level dedup is genuinely hard.** Naive title similarity over-merges (different stories with similar headlines) or under-merges (same story, different framing). **Mitigation:** M4 ships a conservative version first (URL canonicalization + tight title-similarity threshold). Loose clustering / topic modeling can come later if needed.
- **Bluesky ATProto rate limits.** Public author feeds are throttled. **Mitigation:** reuse the exponential-backoff pattern in `poll-feeds.ts` (capped at 24h). Don't compound errors across feeds — one feed's 429 shouldn't affect siblings.
- **Migration count.** Already at `0027`; the half adds ~10+ more. **Mitigation:** watch for an inflection point where consolidation makes sense (probably after M6). No action this half.
- **The MCP-only pivot is recent.** If after M2 you discover you actually want a web reader, the roadmap should bend, not double down. **Mitigation:** explicit check-in at end of each phase ("does the original premise still hold?").

---

## 5. Sequencing rationale, in one line each

- **M1 social** — cheapest, validates multi-poller pattern at scale.
- **M2 YouTube** — medium effort, builds the transcript subsystem M-future will lean on.
- **M3 email** — heaviest infra, do once patterns are proven.
- **M4 dedup + read-state** — intelligence becomes urgent only after coverage triples.
- **M5 write tools** — Claude can curate, not just retrieve.
- **M6 admin via MCP** — closes the loop; the web admin becomes optional.

---

## 6. What each milestone produces (artifact-level)

| Milestone | New files (sketch)                                                                   | New migrations           | New MCP tools                     |
|-----------|--------------------------------------------------------------------------------------|--------------------------|-----------------------------------|
| M1        | `src/cron/poll-bluesky.ts`; entries in `source-detect.ts`                            | source_type expansions   | (none new)                        |
| M2        | `src/lib/transcript.ts`; handle resolver in `source-detect.ts`                       | transcript columns       | (none new — extends `get_article`)|
| M3        | `email()` handler in `src/index.ts`; `src/cron/parse-email.ts` (or inline)           | inbound-address column   | `add_feed` accepts email type     |
| M4        | dedup module under `src/lib/dedup.ts`; cursor tracking in DB                         | cluster_id, user_cursor  | `get_unread`; extends `get_recent`|
| M5        | extends `src/mcp/tools.ts`                                                            | `articles.archived_at`   | `tag_article`, `archive_article`, `bookmark_article` |
| M6        | extends `src/mcp/tools.ts`                                                            | (none)                   | `set_scrape_mode`, `repoll_feed`, `get_feed_health`, etc. |

---

## 7. Next steps

1. This roadmap doc gets reviewed and committed.
2. Brainstorm M1 (social feeds) → spec → plan, then implement.
3. Phase boundary check-ins: at end of M3 and end of M6, re-evaluate whether the roadmap still reflects reality.
