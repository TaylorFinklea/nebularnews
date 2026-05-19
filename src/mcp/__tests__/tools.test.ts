import { describe, it, expect } from 'vitest';
import { buildAlsoSeenInMap } from '../tools';

describe('buildAlsoSeenInMap', () => {
  it('groups rows by primary_id', () => {
    const rows = [
      { primary_id: 'a1', feed_id: 'f1', feed_title: 'Feed 1' },
      { primary_id: 'a1', feed_id: 'f2', feed_title: 'Feed 2' },
      { primary_id: 'a2', feed_id: 'f3', feed_title: 'Feed 3' },
    ];
    const map = buildAlsoSeenInMap(rows);
    expect(map.get('a1')).toEqual([
      { feed_id: 'f1', feed_title: 'Feed 1' },
      { feed_id: 'f2', feed_title: 'Feed 2' },
    ]);
    expect(map.get('a2')).toEqual([
      { feed_id: 'f3', feed_title: 'Feed 3' },
    ]);
  });

  it('returns empty map for empty input', () => {
    expect(buildAlsoSeenInMap([])).toEqual(new Map());
  });

  it('handles a single primary with a single sibling', () => {
    const map = buildAlsoSeenInMap([{ primary_id: 'a1', feed_id: 'f1', feed_title: 'Feed 1' }]);
    expect(map.size).toBe(1);
    expect(map.get('a1')).toEqual([{ feed_id: 'f1', feed_title: 'Feed 1' }]);
  });

  it('preserves row order within a group (DB ordering)', () => {
    const rows = [
      { primary_id: 'a1', feed_id: 'f1', feed_title: 'A' },
      { primary_id: 'a1', feed_id: 'f2', feed_title: 'B' },
      { primary_id: 'a1', feed_id: 'f3', feed_title: 'C' },
    ];
    const map = buildAlsoSeenInMap(rows);
    expect(map.get('a1')!.map((x) => x.feed_title)).toEqual(['A', 'B', 'C']);
  });

  it('handles null feed_title by coercing to empty string', () => {
    const rows = [{ primary_id: 'a1', feed_id: 'f1', feed_title: null }];
    const map = buildAlsoSeenInMap(rows);
    expect(map.get('a1')).toEqual([{ feed_id: 'f1', feed_title: '' }]);
  });
});
