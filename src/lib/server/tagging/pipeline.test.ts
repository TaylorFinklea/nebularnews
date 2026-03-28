import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTagLinksForArticleMock = vi.hoisted(() => vi.fn());
const attachTagToArticleMock = vi.hoisted(() => vi.fn(async () => undefined));
const detachTagFromArticleMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../tags', () => ({
  attachTagToArticle: attachTagToArticleMock,
  detachTagFromArticle: detachTagFromArticleMock,
  listTagLinksForArticle: listTagLinksForArticleMock,
  serializeArticleTagLinkState: (links: Array<{ tagId: string; source: string; confidence: number | null }>) =>
    [...links]
      .map((link) => `${link.tagId}:${link.source}:${link.confidence === null ? 'null' : Number(link.confidence).toFixed(3)}`)
      .sort()
      .join('|')
}));

import { applyDeterministicTagDecisions } from './rules';

describe('deterministic tagging pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates only system tags and preserves manual tags with the same tag id', async () => {
    listTagLinksForArticleMock
      .mockResolvedValueOnce([
        { tagId: 'tag-old', source: 'system', confidence: 0.8 },
        { tagId: 'tag-manual', source: 'manual', confidence: null }
      ])
      .mockResolvedValueOnce([{ tagId: 'tag-new', source: 'system', confidence: 0.9 }]);

    const result = await applyDeterministicTagDecisions({} as any, 'article-1', [
      { tagId: 'tag-manual', score: 1, confidence: 1, features: ['title_phrase'] },
      { tagId: 'tag-new', score: 0.9, confidence: 0.9, features: ['url_phrase'] }
    ]);

    expect(detachTagFromArticleMock).toHaveBeenCalledWith(expect.anything(), 'article-1', 'tag-old');
    expect(attachTagToArticleMock).toHaveBeenCalledWith(expect.anything(), {
      articleId: 'article-1',
      tagId: 'tag-new',
      source: 'system',
      confidence: 0.9
    });
    expect(result.changed).toBe(true);
    expect(result.skippedExistingTagIds).toEqual(['tag-manual']);
    expect(result.removedTagIds).toEqual(['tag-old']);
    expect(result.attachedTagIds).toEqual(['tag-new']);
  });

  it('reports no change when the system tag state is already current', async () => {
    listTagLinksForArticleMock
      .mockResolvedValueOnce([{ tagId: 'tag-ai', source: 'system', confidence: 0.875 }])
      .mockResolvedValueOnce([{ tagId: 'tag-ai', source: 'system', confidence: 0.875 }]);

    const result = await applyDeterministicTagDecisions({} as any, 'article-1', [
      { tagId: 'tag-ai', score: 0.875, confidence: 0.875, features: ['title_phrase'] }
    ]);

    expect(detachTagFromArticleMock).not.toHaveBeenCalled();
    expect(attachTagToArticleMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.beforeState).toBe(result.afterState);
  });
});
