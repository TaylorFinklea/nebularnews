# M2 — YouTube `@handles` + Transcripts (Design)

**Date:** 2026-05-15
**Milestone:** M2 of the 6-month roadmap
**Roadmap reference:** `docs/superpowers/specs/2026-05-15-roadmap-design.md` → Phase 1 → M2
**Operator:** Single user
**Outcome:** *"I can give Claude a YouTube video and it knows what's in it."*

---

## 1. Goals & non-goals

### Goal

Make `add_feed` accept `https://youtube.com/@MKBHD` (today: rejected at `source-detect.ts:46`). New videos from any subscribed channel land with their full transcript text in `articles.content_text` so MCP `search_articles` works over video content. Videos without captions still ingest cleanly as metadata-only — no error, just no transcript.

### Non-goals

- **No backfill** of pre-M2 videos. They stay metadata-only.
- **No segment timing** surfaced through MCP. Full concatenated text in `content_text`; timestamps stay in `source_data_json` only if a future need emerges.
- **No multi-language picking strategy.** Pick the first English caption track if available, else the first track at all. Store the language code so future code can be smarter.
- **No paid third-party fallback.** Innertube-style scrape only. If coverage proves <70% in real use, we revisit in a follow-up.
- **No transcript regeneration.** Auto-captions don't meaningfully change post-publish.
- **No transcript-specific MCP tools.** `search_articles` / `get_article` already work over `content_text`.
- **No provider interface yet.** One consumer, one provider, no abstraction. Refactor when a second consumer appears (M3 email? podcasts? Spaces?).

---

## 2. Components & data flow

Three new pieces and one extension.

### A. `@handle` resolution — extend `src/lib/source-detect.ts`

Replace the current error branch at `source-detect.ts:46` (which rejects all `@handle` inputs) with a network-based resolver:

```
detectSource('https://youtube.com/@MKBHD')
  → fetch the channel page HTML
  → extract <link rel="canonical" href="https://www.youtube.com/channel/UC...">
  → return { type: 'youtube', url: 'UCxxx...', displayLabel: 'YouTube: @MKBHD' }
```

Fallback: if canonical is missing, try `<meta itemprop="channelId" content="UC...">`. If both fail, return `{ error: 'Could not resolve channel ID for @<handle> — paste the /channel/UC… URL instead.' }`.

**`detectSource` becomes async.** Every call site must `await` it. Call sites: `POST /api/feeds` (`src/routes/feeds.ts`), the MCP `add_feed` tool (`src/mcp/tools.ts`). Both already use async functions, so the change is non-breaking — but every existing test in `source-detect.test.ts` needs `await` added.

### B. Transcript subsystem — new `src/lib/transcript.ts`

Pure function: `fetchTranscript(videoId): Promise<TranscriptResult | null>` where

```ts
type TranscriptResult = {
  text: string;        // full concatenated transcript
  language: string;    // e.g. 'en', 'en-US', 'de'
  segmentCount: number;
};
```

Internally:

1. `POST https://www.youtube.com/youtubei/v1/player` with body `{ context: { client: { clientName: 'WEB', clientVersion: '2.20231201.01.00' } }, videoId }`. The client context is the minimal anonymous WEB shape that returns captions metadata.
2. Parse `response.captions.playerCaptionsTracklistRenderer.captionTracks[]`.
3. Track selection: first track with `languageCode.startsWith('en')`, else first track at all, else return null.
4. Fetch the track's `baseUrl` with `?fmt=json3` appended.
5. Parse JSON3 events; concatenate `segs[].utf8` text into a flat string.
6. Return `{ text, language, segmentCount }`.

**Failure modes return `null`** (not throws): no captions available, network failure, malformed response, 4xx/5xx from either endpoint. Throws only for genuine programmer bugs (e.g., undefined videoId).

### C. New cron handler — `src/cron/fetch-pending-transcripts.ts`

Runs on the existing hourly cron (`0 * * * *`) alongside `retry-empty-articles`. Each tick:

```sql
SELECT id, source_data_json FROM articles
WHERE source_type = 'youtube'
  AND transcript_fetched_at IS NULL
  AND transcript_attempt_count < 3
  AND published_at > <30 days ago>
ORDER BY published_at DESC
LIMIT 25
```

For each row:
- Extract `video_id` from `source_data_json` (parse JSON, read `.video_id`).
- Call `fetchTranscript(videoId)`.
- **On success:** `UPDATE articles SET content_text=?, word_count=?, excerpt=?, transcript_fetched_at=?, transcript_lang=?, source_data_json=<merged with has_transcript=true>`.
- **On null/failure:** `UPDATE articles SET transcript_attempt_count=transcript_attempt_count+1, transcript_last_error=?`. After 3 failed attempts a video stops being retried (saves cron budget on permanently uncaptioned videos like live streams or shorts that don't generate captions).

Records a `pull_runs` row at the end with `stats_json = { source: 'youtube-transcripts', candidates, fetched, failed }`.

### D. Schema — migration `0028_youtube_transcripts.sql`

Four new nullable columns on `articles`:

```sql
ALTER TABLE articles ADD COLUMN transcript_fetched_at INTEGER;
ALTER TABLE articles ADD COLUMN transcript_lang TEXT;
ALTER TABLE articles ADD COLUMN transcript_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN transcript_last_error TEXT;

CREATE INDEX idx_articles_transcript_pending
  ON articles (source_type, transcript_fetched_at, transcript_attempt_count)
  WHERE source_type = 'youtube';
```

Index supports the cron selector cheaply. `WHERE source_type = 'youtube'` makes it a partial index — small and targeted.

### Data flow (end to end)

```
1. User: add_feed("https://youtube.com/@MKBHD")
   → source-detect fetches channel page, extracts UCabc... canonical
   → POST /api/feeds stores feed row with url='UCabc...', source_type='youtube'

2. Every 5min cron:
   → poll-youtube fetches /feeds/videos.xml?channel_id=UCabc...
   → For each new video: INSERT article with content_text = description (often empty)
   → source_data_json includes { video_id, channel_id, has_transcript: false }
   → transcript_fetched_at = NULL by default

3. Every hour cron:
   → fetch-pending-transcripts selects youtube articles with no transcript
   → For each: fetchTranscript(video_id)
     · success: UPDATE article (content_text now = full transcript), transcript_fetched_at = now
     · failure: increment attempt_count; after 3 strikes stop retrying

4. MCP search_articles / get_article now returns video content as if it were an article.
```

---

## 3. Risks & known unknowns

- **Innertube payload churn.** YouTube's `youtubei/v1/player` endpoint is undocumented. Request body shape and response paths can change. **Mitigation:** keep the request body minimal; test against a captured fixture so breakage shows up as a parse failure. When break happens, 3-strike cap means we stop hitting YouTube for already-failed videos.
- **Rate limiting.** No documented anonymous quota, but unauthenticated bulk requests can throttle. **Mitigation:** 25 videos/tick cap; on 429, skip remaining cron batch and let next hour retry.
- **Channel-page HTML format change.** `<link rel="canonical">` is the standard meta and very stable. **Mitigation:** fallback to `<meta itemprop="channelId">`; if both fail, error at `add_feed` time with an actionable message.
- **`detectSource` async migration.** TypeScript will catch any missed `await`; risk is low.
- **30-day backlog window.** Could miss videos if the cron is offline for a stretch. **Mitigation:** for personal scale, monitor `pull_runs`; widen window if needed.
- **Live streams and premieres.** These return no captions and may 404 the player endpoint. The 3-strike cap absorbs them.
- **Shorts.** YouTube Shorts often have auto-captions; should behave the same as regular videos. Verified during testing.

---

## 4. Testing

**`source-detect.test.ts`** (modify existing)
- Every existing test gets `await` added (TypeScript will guide).
- New test: `'resolves @handle to UC channel id via canonical tag'` — mock `globalThis.fetch` to return HTML with `<link rel="canonical" href="https://www.youtube.com/channel/UCxxx">`, verify resolved output.
- New test: `'falls back to <meta itemprop=\"channelId\">'` — mock HTML without canonical but with the itemprop meta.
- New test: `'errors when neither canonical nor itemprop is present'` — mock HTML without either, verify `{ error: ... }` shape.
- New test: `'errors on network failure for @handle resolution'`.

**`transcript.test.ts`** (new) — pure-function tests against captured fixtures.
- Fixture `youtubei-player-response.json`: real shape captured from a public video with English captions.
- Fixture `caption-track-en.json`: real json3 captions track.
- Tests:
  - `'returns full concatenated text when English captions available'`
  - `'prefers English when both English and non-English tracks are present'`
  - `'returns null when no captions metadata present'`
  - `'returns null when player response is malformed'`
  - `'returns the language code from the selected track'`
  - `'counts segments accurately'`

**`fetch-pending-transcripts.test.ts`** (new) — only pure parts.
- Test the `videoIdFromSourceData(json)` helper: well-formed JSON returns video_id; missing field returns null; malformed JSON returns null.
- Orchestrator itself isn't unit-tested (DB + network), matching the existing cron pattern (poll-feeds, poll-reddit, etc.).

---

## 5. File structure

**Modify:**
- `src/lib/source-detect.ts` — replace `@handle` error branch with async resolver; widen return type to `Promise<DetectedSource | {error: string}>`.
- `src/lib/__tests__/source-detect.test.ts` — add `await` everywhere; add `@handle` resolution tests with mocked fetch.
- `src/routes/feeds.ts` and `src/mcp/tools.ts` — add `await` to `detectSource()` calls (probably already there given existing tests use async/await).
- `src/index.ts` — dispatch `fetchPendingTranscripts` in the hourly cron handler alongside `retryEmptyArticles`.
- `wrangler.toml` — no change (cron schedule unchanged).
- `CLAUDE.md` — update cron mapping table (hourly slot now has both retry-empty-articles + fetch-pending-transcripts); brief mention of transcript columns in architecture map.

**Create:**
- `src/lib/transcript.ts` — `fetchTranscript`, `TranscriptResult`, internal helpers.
- `src/lib/__tests__/transcript.test.ts` — fixture-driven tests.
- `src/lib/__tests__/fixtures/youtubei-player-response.json` — captured real response with English captions metadata.
- `src/lib/__tests__/fixtures/caption-track-en.json` — captured real json3 track.
- `src/cron/fetch-pending-transcripts.ts` — orchestrator.
- `src/cron/__tests__/fetch-pending-transcripts.test.ts` — pure-helper tests.
- `migrations/0028_youtube_transcripts.sql` — schema.

---

## 6. Exit criteria

1. `add_feed("https://youtube.com/@MKBHD")` succeeds (via both HTTP `POST /api/feeds` and the MCP `add_feed` tool), stores the resolved UC id, and the channel polls normally.
2. `add_feed("https://youtube.com/@bogus_nonexistent_handle")` returns a clear error.
3. Subscribed channels' new videos land in `articles` with `content_text` populated by transcript within ~1 cron tick (1 hour) of being indexed.
4. Videos without captions stay metadata-only after 3 attempts; `transcript_last_error` records the reason.
5. MCP `search_articles("specific phrase from a video")` returns the matching video.
6. The cron's selector query stays under 100ms locally with a synthetic 1000-row articles table (the partial index is doing its job).
7. Migration `0028` applies cleanly via `npm run migrate:local`.

---

## 7. Sequencing (implementation order — feeds into the plan)

1. Migration `0028_youtube_transcripts.sql` first — schema lands before code references new columns.
2. `src/lib/transcript.ts` + tests with fixtures — pure helper, no integration yet.
3. `src/cron/fetch-pending-transcripts.ts` — uses the helper, wires the DB.
4. Wire the new cron into `src/index.ts` scheduled handler.
5. `@handle` resolver in `src/lib/source-detect.ts` — make detectSource async; update call sites.
6. CLAUDE.md update.
7. End-to-end manual verification.

The handle resolver could go first or last; placing it after the transcript work means the @handle feature ships alongside a working transcript pipeline rather than landing first and creating a UX gap where @handles work but transcripts don't.

---

## 8. Open follow-ups (not in M2)

- **If coverage is poor:** revisit and add a paid fallback (supadata/kome.ai) gated by an env flag.
- **Backfill of pre-M2 videos:** a one-shot script or admin endpoint to flip pre-M2 youtube articles into the retry pool.
- **Provider interface refactor:** when M3 (email) or podcasts land and need similar fetch-then-attach behavior.
- **Live transcript refresh for ongoing series:** if the user finds value in re-fetching after auto-captions improve.
