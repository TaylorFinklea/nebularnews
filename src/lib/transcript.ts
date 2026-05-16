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
