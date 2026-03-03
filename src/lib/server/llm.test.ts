import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateNewsBrief } from './llm';

describe('generateNewsBrief', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('forces one article per bullet and asks the model for exactly one source id', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                bullets: [
                  {
                    text: 'OpenAI shipped a major release.',
                    source_article_ids: ['article-1', 'article-2']
                  }
                ]
              })
            }
          }
        ],
        usage: { total_tokens: 42 }
      })
    } as Response);

    const result = await generateNewsBrief('openai', 'test-key', 'gpt-4o', {
      windowLabel: 'Last 48 hours',
      candidates: [
        {
          id: 'article-1',
          title: 'OpenAI release',
          sourceName: 'Example Feed',
          publishedAt: Date.UTC(2026, 2, 3, 12, 0, 0),
          effectiveScore: 5,
          context: 'Launch confirmed'
        },
        {
          id: 'article-2',
          title: 'Second article',
          sourceName: 'Example Feed',
          publishedAt: Date.UTC(2026, 2, 3, 11, 0, 0),
          effectiveScore: 4,
          context: 'More context'
        }
      ],
      maxBullets: 5,
      maxSourcesPerBullet: 3
    });

    expect(result.bullets).toEqual([
      {
        text: 'OpenAI shipped a major release.',
        sourceArticleIds: ['article-1']
      }
    ]);

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request?.body ?? '{}'));
    const prompt = String(body?.messages?.[1]?.content ?? '');
    expect(prompt).toContain('Each bullet must summarize exactly one notable article');
    expect(prompt).toContain('Each bullet must cite exactly one source_article_id');
    expect(prompt).not.toContain('should synthesize developments');
  });
});
