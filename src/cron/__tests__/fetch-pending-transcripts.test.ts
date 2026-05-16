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
