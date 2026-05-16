# M2 — YouTube `@handles` + Transcripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `add_feed` accept `https://youtube.com/@MKBHD` (today: rejected) and attach full transcript text to new YouTube videos so `search_articles` works over their content.

**Architecture:** A new pure helper `fetchTranscript(videoId)` in `src/lib/transcript.ts` hits YouTube's anonymous `youtubei/v1/player` endpoint to discover captions, then fetches the json3 caption track and concatenates segments. A new hourly cron handler `fetch-pending-transcripts.ts` (sibling to `retry-empty-articles`) picks up to 25 youtube articles still missing transcripts and runs them through the helper, with a 3-strike attempt cap. Separately, `detectSource` becomes `async` so the `@handle` branch in `source-detect.ts` can resolve to a UC channel id by fetching the channel page and reading `<link rel="canonical">`.

**Tech Stack:** Cloudflare Workers, Hono, D1 (raw SQL), Vitest (with `vi.spyOn(globalThis, 'fetch')` mocking), native `fetch`. No new npm dependencies.

---

## File Structure

**Create**
- `migrations/0028_youtube_transcripts.sql` — schema additions for transcript metadata.
- `src/lib/transcript.ts` — `fetchTranscript(videoId): Promise<TranscriptResult | null>` and the `TranscriptResult` type.
- `src/lib/__tests__/transcript.test.ts` — fixture-driven tests via mocked fetch.
- `src/lib/__tests__/fixtures/youtubei-player-response.json` — minimal `/youtubei/v1/player` response with 2 caption tracks (English + German).
- `src/lib/__tests__/fixtures/caption-track-en.json` — 2-event json3 caption track.
- `src/cron/fetch-pending-transcripts.ts` — orchestrator: selects pending articles, calls helper, updates DB.
- `src/cron/__tests__/fetch-pending-transcripts.test.ts` — pure-helper tests (`videoIdFromSourceData`).

**Modify**
- `src/lib/source-detect.ts` — `detectSource` becomes async; add YouTube `@handle` resolver.
- `src/lib/__tests__/source-detect.test.ts` — add `await` to every existing `detectSource` call; add resolver tests with mocked fetch.
- `src/routes/feeds.ts` — `await` the detectSource call.
- `src/mcp/tools.ts` — `await` the detectSource call inside `add_feed` tool dispatch.
- `src/index.ts` — dispatch `fetchPendingTranscripts` in the `0 * * * *` cron handler.
- `CLAUDE.md` — update Cron→handler table (hourly now has 2 dispatches); brief mention of transcript columns.

Each file has one responsibility. `transcript.ts` is the pure helper; `fetch-pending-transcripts.ts` is the side-effecting orchestrator. The split mirrors `bluesky.ts` ↔ `poll-bluesky.ts` from M1.

---

## Sequencing

1. Migration first — schema lands before code references new columns.
2. Transcript helper with fixture-driven tests.
3. New cron handler using the helper.
4. Wire the cron into the scheduled dispatcher.
5. Make detectSource async (mechanical refactor, no functional change yet).
6. Add `@handle` resolution + tests.
7. Update CLAUDE.md.
8. Manual end-to-end verification.

The `@handle` resolver lands AFTER the transcript pipeline so the feature ships cohesively — not in a state where @handles work but their videos have no transcripts.

---

## Task 1: Migration 0028 — schema for transcript metadata

**Files:**
- Create: `migrations/0028_youtube_transcripts.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 0028 — YouTube transcript metadata
--
-- M2 of the 6-month roadmap. New columns on articles to track per-video
-- transcript state: when fetched, what language, how many attempts,
-- last error reason. Partial index on (source_type, transcript_fetched_at,
-- transcript_attempt_count) supports the hourly cron's pending-transcripts
-- selector query cheaply.

ALTER TABLE articles ADD COLUMN transcript_fetched_at INTEGER;
ALTER TABLE articles ADD COLUMN transcript_lang TEXT;
ALTER TABLE articles ADD COLUMN transcript_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN transcript_last_error TEXT;

CREATE INDEX idx_articles_transcript_pending
  ON articles (source_type, transcript_fetched_at, transcript_attempt_count)
  WHERE source_type = 'youtube';
```

- [ ] **Step 2: Apply migration locally**

Run: `npm run migrate:local`
Expected: applies `0028_youtube_transcripts.sql` without error.

- [ ] **Step 3: Verify the new columns**

Run: `npx wrangler d1 execute DB --local --command "PRAGMA table_info(articles);" 2>&1 | tail -20`
Expected: 4 new columns visible — `transcript_fetched_at`, `transcript_lang`, `transcript_attempt_count`, `transcript_last_error`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0028_youtube_transcripts.sql
git commit -m "feat(db): migration 0028 — youtube transcript metadata columns"
```

---

## Task 2: `fetchTranscript` helper with fixture-driven tests

The pure helper that hits YouTube's anonymous innertube endpoint, picks an English caption track (or first available), fetches the json3 segments, and concatenates them. Fixture-driven; no live network calls in tests.

**Files:**
- Create: `src/lib/__tests__/fixtures/youtubei-player-response.json`
- Create: `src/lib/__tests__/fixtures/caption-track-en.json`
- Create: `src/lib/__tests__/transcript.test.ts`
- Create: `src/lib/transcript.ts`

- [ ] **Step 1: Capture the player-response fixture**

Save as `src/lib/__tests__/fixtures/youtubei-player-response.json`:

```json
{
  "captions": {
    "playerCaptionsTracklistRenderer": {
      "captionTracks": [
        {
          "baseUrl": "https://www.youtube.com/api/timedtext?v=FAKE&caps=asr&fmt=srv1&lang=de",
          "name": { "simpleText": "German" },
          "vssId": ".de",
          "languageCode": "de"
        },
        {
          "baseUrl": "https://www.youtube.com/api/timedtext?v=FAKE&caps=asr&fmt=srv1",
          "name": { "simpleText": "English" },
          "vssId": ".en",
          "languageCode": "en"
        }
      ]
    }
  }
}
```

Note: German is listed first deliberately to exercise the "prefer English" logic.

- [ ] **Step 2: Capture the caption-track fixture**

Save as `src/lib/__tests__/fixtures/caption-track-en.json`:

```json
{
  "wireMagic": "pb3",
  "events": [
    { "tStartMs": 0,    "dDurationMs": 3000, "segs": [{ "utf8": "Hello " }, { "utf8": "world." }] },
    { "tStartMs": 3000, "dDurationMs": 2500, "segs": [{ "utf8": "This is a test." }] }
  ]
}
```

Concatenated text: `"Hello world.This is a test."` (no whitespace added between events — segment-internal whitespace is preserved as-is in the source).

- [ ] **Step 3: Write failing tests**

Create `src/lib/__tests__/transcript.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchTranscript } from '../transcript';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const playerResponse = JSON.parse(readFileSync(join(fixturesDir, 'youtubei-player-response.json'), 'utf8'));
const captionTrackEn = JSON.parse(readFileSync(join(fixturesDir, 'caption-track-en.json'), 'utf8'));

function mockFetch(...responses: Array<unknown | { status: number }>) {
  const spy = vi.spyOn(globalThis, 'fetch');
  for (const r of responses) {
    if (r && typeof r === 'object' && 'status' in r && Object.keys(r).length === 1) {
      spy.mockResolvedValueOnce(new Response(null, { status: (r as { status: number }).status }));
    } else {
      spy.mockResolvedValueOnce(new Response(JSON.stringify(r)));
    }
  }
  return spy;
}

describe('fetchTranscript', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns concatenated text when English captions are available', async () => {
    mockFetch(playerResponse, captionTrackEn);
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello world.This is a test.');
    expect(result!.language).toBe('en');
    expect(result!.segmentCount).toBe(2);
  });

  it('prefers English even when listed second in the tracks array', async () => {
    mockFetch(playerResponse, captionTrackEn);
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result!.language).toBe('en');
  });

  it('returns null when no captions metadata is present', async () => {
    mockFetch({}, {}); // empty player response
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result).toBeNull();
  });

  it('returns null when captionTracks is an empty array', async () => {
    mockFetch({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } } });
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result).toBeNull();
  });

  it('returns null when player API returns 404', async () => {
    mockFetch({ status: 404 });
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result).toBeNull();
  });

  it('returns null when caption track fetch returns 4xx', async () => {
    mockFetch(playerResponse, { status: 403 });
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result).toBeNull();
  });

  it('falls back to first track when no English is available', async () => {
    const noEnglish = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=FAKE&lang=de', languageCode: 'de' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=FAKE&lang=fr', languageCode: 'fr' },
          ],
        },
      },
    };
    mockFetch(noEnglish, captionTrackEn);
    const result = await fetchTranscript('FAKE_VIDEO_ID');
    expect(result!.language).toBe('de');
  });
});
```

- [ ] **Step 4: Run tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/transcript.test.ts`
Expected: 7 tests fail with "Cannot find module '../transcript'".

- [ ] **Step 5: Implement `fetchTranscript`**

Create `src/lib/transcript.ts`:

```ts
// YouTube transcript fetcher. Hits the anonymous innertube /player endpoint
// to discover caption tracks, then fetches the json3 track and concatenates
// segment text. Pure function: no DB, no global state. Returns null for
// every soft-failure (no captions, 4xx, 5xx, malformed response). Throws
// only for genuine programmer bugs (e.g., undefined videoId).
//
// Why innertube and not the official Data API: anonymous access, includes
// auto-captions (which the documented /api/timedtext endpoint doesn't),
// matches what yt-dlp does. Trade-off: undocumented, can break — but the
// 3-strike cap in fetch-pending-transcripts insulates us against churn.

export interface TranscriptResult {
  text: string;
  language: string;
  segmentCount: number;
}

// Public web-client key. Not auth — same value for every browser hitting
// youtube.com. Stable for years; if it ever rotates, replace here.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_PLAYER = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`;

const CLIENT_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20231201.01.00',
    hl: 'en',
  },
};

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
}

interface PlayerResponse {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

interface Json3Track {
  events?: Array<{
    segs?: Array<{ utf8?: string }>;
  }>;
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const english = tracks.find((t) => t.languageCode?.toLowerCase().startsWith('en'));
  return english ?? tracks[0];
}

export async function fetchTranscript(videoId: string): Promise<TranscriptResult | null> {
  if (!videoId) throw new Error('videoId required');

  let playerJson: PlayerResponse;
  try {
    const res = await fetch(INNERTUBE_PLAYER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NebularNews/1.0 (MCP server; +https://nebularnews.com)',
      },
      body: JSON.stringify({ context: CLIENT_CONTEXT, videoId }),
    });
    if (!res.ok) return null;
    playerJson = await res.json() as PlayerResponse;
  } catch {
    return null;
  }

  const tracks = playerJson.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks)) return null;
  const track = pickTrack(tracks);
  if (!track || !track.baseUrl || !track.languageCode) return null;

  const trackUrl = track.baseUrl.includes('fmt=')
    ? track.baseUrl.replace(/fmt=[^&]+/, 'fmt=json3')
    : `${track.baseUrl}&fmt=json3`;

  let trackJson: Json3Track;
  try {
    const res = await fetch(trackUrl);
    if (!res.ok) return null;
    trackJson = await res.json() as Json3Track;
  } catch {
    return null;
  }

  const events = trackJson.events;
  if (!Array.isArray(events) || events.length === 0) return null;

  let text = '';
  let segmentCount = 0;
  for (const event of events) {
    if (!event.segs) continue;
    for (const seg of event.segs) {
      if (typeof seg.utf8 === 'string') text += seg.utf8;
    }
    segmentCount++;
  }

  if (text.length === 0) return null;

  return { text, language: track.languageCode, segmentCount };
}
```

- [ ] **Step 6: Run tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/transcript.test.ts`
Expected: 7 tests pass.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/transcript.ts src/lib/__tests__/transcript.test.ts src/lib/__tests__/fixtures/youtubei-player-response.json src/lib/__tests__/fixtures/caption-track-en.json
git commit -m "feat(transcript): innertube-based fetchTranscript with fixture tests"
```

---

## Task 3: `fetch-pending-transcripts` cron handler

The hourly orchestrator. Selects up to 25 youtube articles missing transcripts (within a 30-day window, capped at 3 attempts), runs them through `fetchTranscript`, updates DB.

**Files:**
- Create: `src/cron/fetch-pending-transcripts.ts`
- Create: `src/cron/__tests__/fetch-pending-transcripts.test.ts`

- [ ] **Step 1: Write failing tests for the pure helper**

Create `src/cron/__tests__/fetch-pending-transcripts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { videoIdFromSourceData } from '../fetch-pending-transcripts';

describe('videoIdFromSourceData', () => {
  it('extracts video_id from well-formed source_data_json', () => {
    expect(videoIdFromSourceData('{"video_id":"dQw4w9WgXcQ","channel_id":"UC1"}')).toBe('dQw4w9WgXcQ');
  });

  it('returns null when video_id field is missing', () => {
    expect(videoIdFromSourceData('{"channel_id":"UC1"}')).toBeNull();
  });

  it('returns null when source_data_json is null', () => {
    expect(videoIdFromSourceData(null)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(videoIdFromSourceData('not-json')).toBeNull();
  });

  it('returns null when video_id is not a string', () => {
    expect(videoIdFromSourceData('{"video_id":123}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run; verify they fail**

Run: `npx vitest run src/cron/__tests__/fetch-pending-transcripts.test.ts`
Expected: fails with "Cannot find module '../fetch-pending-transcripts'".

- [ ] **Step 3: Implement the cron handler**

Create `src/cron/fetch-pending-transcripts.ts`:

```ts
import { nanoid } from 'nanoid';
import type { Env } from '../env';
import { dbAll, dbRun } from '../db/helpers';
import { fetchTranscript } from '../lib/transcript';

// Cron sibling to retry-empty-articles. Runs on the hourly slot and picks
// up to 25 youtube articles that still don't have a transcript attached,
// running each through fetchTranscript and updating the DB. A 3-strike cap
// prevents permanently-uncaptioned videos (live streams, shorts without
// auto-captions, region-locked, etc.) from being retried forever.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 25;
const MAX_ATTEMPTS = 3;

interface PendingRow {
  id: string;
  source_data_json: string | null;
}

/**
 * Extract the YouTube video id from an article's source_data_json.
 * Returns null for any malformed input.
 */
export function videoIdFromSourceData(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { video_id?: unknown };
    return typeof parsed.video_id === 'string' ? parsed.video_id : null;
  } catch {
    return null;
  }
}

export async function fetchPendingTranscripts(env: Env): Promise<void> {
  const db = env.DB;
  const now = Date.now();
  const since = now - THIRTY_DAYS_MS;

  const rows = await dbAll<PendingRow>(
    db,
    `SELECT id, source_data_json
       FROM articles
      WHERE source_type = 'youtube'
        AND transcript_fetched_at IS NULL
        AND transcript_attempt_count < ?
        AND published_at > ?
      ORDER BY published_at DESC
      LIMIT ?`,
    [MAX_ATTEMPTS, since, BATCH_LIMIT],
  );

  if (rows.length === 0) return;

  let fetched = 0;
  let failed = 0;

  for (const row of rows) {
    const videoId = videoIdFromSourceData(row.source_data_json);
    if (!videoId) {
      await dbRun(
        db,
        `UPDATE articles
            SET transcript_attempt_count = transcript_attempt_count + 1,
                transcript_last_error = ?
          WHERE id = ?`,
        ['missing video_id in source_data_json', row.id],
      );
      failed++;
      continue;
    }

    try {
      const result = await fetchTranscript(videoId);
      if (!result) {
        await dbRun(
          db,
          `UPDATE articles
              SET transcript_attempt_count = transcript_attempt_count + 1,
                  transcript_last_error = ?
            WHERE id = ?`,
          ['no transcript available', row.id],
        );
        failed++;
        continue;
      }

      const excerpt = result.text.slice(0, 300);
      const wordCount = result.text.split(/\s+/).filter(Boolean).length;

      // Merge has_transcript=true into source_data_json. Read existing JSON,
      // set the flag, write back. Null/malformed → start from {}.
      let merged: Record<string, unknown> = {};
      if (row.source_data_json) {
        try { merged = JSON.parse(row.source_data_json) as Record<string, unknown>; }
        catch { merged = {}; }
      }
      merged.has_transcript = true;
      merged.transcript_segment_count = result.segmentCount;

      await dbRun(
        db,
        `UPDATE articles
            SET content_text = ?,
                word_count = ?,
                excerpt = ?,
                transcript_fetched_at = ?,
                transcript_lang = ?,
                transcript_last_error = NULL,
                source_data_json = ?
          WHERE id = ?`,
        [result.text, wordCount, excerpt, now, result.language, JSON.stringify(merged), row.id],
      );
      fetched++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[fetch-pending-transcripts] Error for ${row.id}:`, errMsg);
      await dbRun(
        db,
        `UPDATE articles
            SET transcript_attempt_count = transcript_attempt_count + 1,
                transcript_last_error = ?
          WHERE id = ?`,
        [errMsg.slice(0, 500), row.id],
      );
      failed++;
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
      JSON.stringify({ source: 'youtube-transcripts', candidates: rows.length, fetched, failed }),
      now,
      now,
    ],
  );
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `npx vitest run src/cron/__tests__/fetch-pending-transcripts.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cron/fetch-pending-transcripts.ts src/cron/__tests__/fetch-pending-transcripts.test.ts
git commit -m "feat(cron): fetch-pending-transcripts orchestrator + 3-strike cap"
```

---

## Task 4: Wire the new cron into `src/index.ts` scheduled dispatcher

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the import**

In `src/index.ts`, near the other cron imports, add:

```ts
import { fetchPendingTranscripts } from './cron/fetch-pending-transcripts';
```

- [ ] **Step 2: Dispatch it on the hourly cron**

Inside the `scheduled()` handler, locate `case '0 * * * *':` (the hourly slot — currently dispatches `retryEmptyArticles`). Add a second `ctx.waitUntil` call alongside it:

```ts
case '0 * * * *':
  ctx.waitUntil(run('retry-empty-articles', () => retryEmptyArticles(env)));
  ctx.waitUntil(run('fetch-pending-transcripts', () => fetchPendingTranscripts(env)));
  break;
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: all tests pass (existing + new from Tasks 2 & 3).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(cron): dispatch fetch-pending-transcripts on the hourly slot"
```

---

## Task 5: Make `detectSource` async (mechanical refactor)

`detectSource` currently returns `DetectedSource | { error: string }` synchronously. Making it `async` (return type `Promise<DetectedSource | { error: string }>`) is a prerequisite for Task 6's `@handle` resolver, which needs to `await fetch()`. This task is the **mechanical refactor only** — no @handle logic yet. All existing tests must keep passing after `await` is added.

**Files:**
- Modify: `src/lib/source-detect.ts`
- Modify: `src/lib/__tests__/source-detect.test.ts`
- Modify: `src/routes/feeds.ts`
- Modify: `src/mcp/tools.ts`

- [ ] **Step 1: Convert `detectSource` to async**

In `src/lib/source-detect.ts`, change the function signature:

```ts
// FROM:
export function detectSource(rawInput: string): DetectedSource | { error: string } {

// TO:
export async function detectSource(rawInput: string): Promise<DetectedSource | { error: string }> {
```

No body changes yet — only the signature.

- [ ] **Step 2: Add `await` to every test call**

In `src/lib/__tests__/source-detect.test.ts`, every `detectSource(...)` call needs `await`. There are 26 tests. Examples:

```ts
// FROM:
expect(detectSource('r/birding')).toEqual({...});

// TO:
expect(await detectSource('r/birding')).toEqual({...});
```

And every test callback must be `async`:

```ts
// FROM:
it('detects subreddit shorthand', () => {

// TO:
it('detects subreddit shorthand', async () => {
```

The mechanical sweep applies to all 26 tests in the file.

- [ ] **Step 3: Update callers**

In `src/routes/feeds.ts`, find the `detectSource(rawInput)` call and add `await`:

```ts
// FROM:
const detected = detectSource(rawInput);

// TO:
const detected = await detectSource(rawInput);
```

In `src/mcp/tools.ts`, find the `add_feed` tool handler. Locate the `detectSource(...)` call and add `await`:

```ts
// Pattern in tools.ts (inside the handleToolCall switch for 'add_feed'):
const detected = await detectSource(source);
```

If `detectSource` is called from any other location, update those too. Verify with: `grep -rn "detectSource(" src/`

- [ ] **Step 4: Run all tests**

Run: `npm run test`
Expected: all tests pass — the refactor is mechanical and shouldn't change behavior.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. TypeScript will catch any missed `await`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-detect.ts src/lib/__tests__/source-detect.test.ts src/routes/feeds.ts src/mcp/tools.ts
git commit -m "refactor(source-detect): make detectSource async (no behavior change)"
```

---

## Task 6: `@handle` resolution

Replace the YouTube `@handle` error branch in `source-detect.ts` with a resolver that fetches the channel page and extracts the canonical UC id.

**Files:**
- Modify: `src/lib/source-detect.ts`
- Modify: `src/lib/__tests__/source-detect.test.ts`

- [ ] **Step 1: Write failing tests for `@handle` resolution**

Append to `src/lib/__tests__/source-detect.test.ts` a new `describe` block:

```ts
import { vi, beforeEach, afterEach } from 'vitest';

describe('detectSource — YouTube @handle resolution', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('resolves @handle to UC channel id via <link rel="canonical">', async () => {
    const html = `
      <html><head>
        <title>MKBHD - YouTube</title>
        <link rel="canonical" href="https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ">
      </head><body>content</body></html>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toEqual({
      type: 'youtube',
      url: 'UCBJycsmduvYEL83R_U4JriQ',
      displayLabel: 'YouTube: @MKBHD',
    });
  });

  it('falls back to <meta itemprop="channelId"> when canonical is missing', async () => {
    const html = `
      <html><head>
        <meta itemprop="channelId" content="UCBJycsmduvYEL83R_U4JriQ">
      </head><body></body></html>
    `;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(html));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toMatchObject({
      type: 'youtube',
      url: 'UCBJycsmduvYEL83R_U4JriQ',
    });
  });

  it('returns an error when neither canonical nor itemprop is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html><head></head><body>nope</body></html>'));
    const result = await detectSource('https://youtube.com/@bogus');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/resolve channel id/i);
  });

  it('returns an error on 404 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }));
    const result = await detectSource('https://youtube.com/@nonexistent');
    expect(result).toHaveProperty('error');
  });

  it('returns an error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    const result = await detectSource('https://youtube.com/@MKBHD');
    expect(result).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run new tests; verify they fail**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts -t "@handle resolution"`
Expected: 5 tests fail — current code returns the static "not supported yet" error.

- [ ] **Step 3: Implement the resolver**

In `src/lib/source-detect.ts`, locate the YT_HANDLE_RE block (currently returning an error). Replace it with a resolver call. The full diff:

```ts
// Helper, defined at module scope near the other helpers:
async function resolveYoutubeHandle(handle: string): Promise<DetectedSource | { error: string }> {
  let res: Response;
  try {
    res = await fetch(`https://www.youtube.com/@${handle}`, {
      headers: { 'User-Agent': 'NebularNews/1.0 (MCP server; +https://nebularnews.com)' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    return { error: `Failed to fetch channel page for @${handle}: ${msg}` };
  }
  if (!res.ok) {
    return { error: `YouTube returned HTTP ${res.status} for @${handle}.` };
  }
  const html = await res.text();
  const canonical = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i);
  if (canonical) {
    return { type: 'youtube', url: canonical[1], displayLabel: `YouTube: @${handle}` };
  }
  const itemprop = html.match(/<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"/i);
  if (itemprop) {
    return { type: 'youtube', url: itemprop[1], displayLabel: `YouTube: @${handle}` };
  }
  return { error: `Could not resolve channel id for @${handle} — paste the /channel/UC… URL instead.` };
}

// Inside detectSource(), REPLACE the current YT_HANDLE_RE error branch:
// FROM:
//   if (YT_HANDLE_RE.test(input)) {
//     return { error: 'YouTube @handles aren\'t supported yet — ...' };
//   }
//
// TO:
const ytHandleMatch = input.match(YT_HANDLE_RE);
if (ytHandleMatch) {
  return resolveYoutubeHandle(ytHandleMatch[1]);
}
```

- [ ] **Step 4: Run all source-detect tests; verify they pass**

Run: `npx vitest run src/lib/__tests__/source-detect.test.ts`
Expected after deleting the obsolete test: 30 tests pass (26 existing − 1 obsolete + 5 new). The earlier "rejects YouTube @handles with a helpful message" regression test (from M1 Task 1) will now FAIL because the behavior changed — DELETE it as superseded by the 5 new tests, which already cover the failure path via `'returns an error when neither canonical nor itemprop is present'`. (If you prefer to keep it as a mocked-fetch test instead, total becomes 31.)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/source-detect.ts src/lib/__tests__/source-detect.test.ts
git commit -m "feat(source-detect): resolve YouTube @handles to UC channel ids"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Cron → handler table**

Find the `0 * * * *` row. Change:

```
| `0 * * * *`     | `retryEmptyArticles`                                   |
```

to:

```
| `0 * * * *`     | `retryEmptyArticles` + `fetchPendingTranscripts` (parallel) |
```

- [ ] **Step 2: Update the "Ingestion pipelines" paragraph**

After the existing description of poll-feeds / poll-reddit / poll-youtube / poll-bluesky, add a short paragraph:

> `src/cron/fetch-pending-transcripts.ts` runs hourly to attach transcripts to YouTube articles that landed metadata-only. It calls `src/lib/transcript.ts` (innertube-based, no API key), picks 25 youtube articles per tick within a 30-day window, caps each video at 3 attempts. The `articles` table grew four columns for transcript state: `transcript_fetched_at`, `transcript_lang`, `transcript_attempt_count`, `transcript_last_error` (migration `0028`).

- [ ] **Step 3: Update the `source-detect.ts` paragraph**

Find the line documenting YouTube as `UC… channel ID`. Update to include `@handle`:

```
`UC…` channel ID or `@handle` URL (YouTube)
```

Also append a note inside the same paragraph:

> Note: YouTube `@handle` resolution makes one network call to the channel page at `detectSource` time to extract the canonical UC id. Other patterns remain offline.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): record fetch-pending-transcripts cron and @handle resolution"
```

---

## Task 8: End-to-end manual verification

**Files:** (none — verification only)

- [ ] **Step 1: Apply migration and start dev server**

Run: `npm run migrate:local`
Then: `npm run dev`
Wait for wrangler dev to start on port 8787 (or 8788). Note the port.

- [ ] **Step 2: Sign in to obtain a Bearer token**

Browser → `http://localhost:8787/api/auth/sign-in/social/google` (or apple). Complete sign-in. Copy the session token from dev tools.

- [ ] **Step 3: Subscribe to a YouTube channel by `@handle`**

```bash
TOKEN=<paste your bearer token>

curl -sS -X POST http://localhost:8787/api/feeds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://youtube.com/@MKBHD"}'
```

Expected: `{ "ok": true, "data": { "feed_id": "...", "source_type": "youtube", "url": "UCBJyc..." } }` (or whichever channel id MKBHD resolves to).

- [ ] **Step 4: Trigger the 5-min cron for new-video discovery**

```bash
curl -sS "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Expected: 200 OK. Watch the dev log for `[cron:poll-youtube]` — should ingest the channel's recent videos as metadata-only articles.

- [ ] **Step 5: Trigger the hourly cron for transcript attachment**

```bash
curl -sS "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

Expected: 200 OK. Watch the log for `[cron:fetch-pending-transcripts]`. After the call, the most recent videos should have transcripts attached. This may take ~10-30 seconds depending on how many videos are pending.

- [ ] **Step 6: Verify transcripts populated**

```bash
curl -sS "http://localhost:8787/api/articles?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.articles[] | {title, word_count, has_transcript: (.source_data_json | fromjson | .has_transcript)}'
```

Expected: at least some recent videos have `has_transcript: true` and `word_count` in the hundreds-to-thousands (transcript-length).

- [ ] **Step 7: Verify search works over transcript content**

Pick a specific phrase you saw in the dev log from one of the transcribed videos. Then:

```bash
curl -sS http://localhost:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_articles","arguments":{"query":"YOUR PHRASE HERE"}}}'
```

Expected: the matching video appears in the results.

- [ ] **Step 8: Verify a no-captions video stays metadata-only after 3 tries**

Find a recent live-stream archive or shorts video without auto-captions (in the channel's feed). After 3 hourly cron triggers, that video should have `transcript_attempt_count = 3` and `transcript_last_error = 'no transcript available'` (visible via direct D1 query if you want to confirm).

```bash
npx wrangler d1 execute DB --local --command "SELECT id, title, transcript_attempt_count, transcript_last_error FROM articles WHERE source_type='youtube' AND transcript_fetched_at IS NULL LIMIT 5;"
```

Expected: any 3-strike entries have meaningful `transcript_last_error`.

- [ ] **Step 9: Final commit (only if any debug fixes were made during verification)**

If verification surfaced bugs, fix them TDD-style (add a test, then the fix) and commit normally. If nothing changed, skip.

---

## Out of scope (deferred to later milestones)

- Multi-language strategy beyond "English-first, else first-available".
- Transcript regeneration / refresh for videos where YouTube improved auto-captions.
- Backfill of pre-M2 YouTube videos.
- Paid third-party transcript fallback.
- Provider interface for `fetchTranscript` (one consumer for now).
- Surfacing segment timing through MCP tools.
- Manual "fetch transcript for this video" trigger via MCP.
- Live stream and premiere special-casing beyond the 3-strike absorption.
