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
    mockFetch({}, {});
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
