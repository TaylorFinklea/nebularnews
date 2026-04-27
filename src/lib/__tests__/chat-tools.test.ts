import { describe, it, expect } from 'vitest';
import { executeServerTool, type ToolExecutionContext } from '../chat-tools';

// Minimal D1-shaped fake. Captures all SQL+bind pairs and returns canned
// rows by SQL pattern. Enough surface for the tools we exercise here
// (save_articles, react_to_articles); not a general-purpose mock.
function makeFakeD1(opts: {
  articles?: Array<{ id: string }>;
  sources?: Array<{ article_id: string; feed_id: string }>;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const articles = opts.articles ?? [];
  const sources = opts.sources ?? [];

  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => null,
      all: async () => {
        calls.push({ sql, params });
        if (sql.includes('FROM articles WHERE id IN')) {
          const ids = params as string[];
          return { results: articles.filter((a) => ids.includes(a.id)) };
        }
        if (sql.includes('FROM article_sources WHERE article_id IN')) {
          const ids = params as string[];
          // Return one source row per matching article (GROUP BY in real SQL).
          return {
            results: sources.filter((s) => ids.includes(s.article_id)),
          };
        }
        return { results: [] };
      },
      run: async () => {
        calls.push({ sql, params });
        return { success: true, meta: { changes: 1, last_row_id: 0 } };
      },
    }),
  });

  return {
    db: { prepare } as unknown as D1Database,
    calls,
  };
}

function makeContext(db: D1Database): ToolExecutionContext {
  return {
    userId: 'user-1',
    db,
    req: new Request('https://example.com'),
    env: {},
  };
}

describe('save_articles tool', () => {
  it('rejects an empty article_ids array', async () => {
    const { db } = makeFakeD1({});
    const result = await executeServerTool(
      { id: 'c1', name: 'save_articles', args: { article_ids: [] } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(false);
    expect(result.summary).toMatch(/nothing/i);
  });

  it('reports when no supplied ids exist', async () => {
    const { db } = makeFakeD1({ articles: [] });
    const result = await executeServerTool(
      { id: 'c2', name: 'save_articles', args: { article_ids: ['ghost-1', 'ghost-2'] } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(false);
    expect(result.summary).toMatch(/no articles/i);
  });

  it('saves valid ids and returns an undo spec', async () => {
    const { db, calls } = makeFakeD1({
      articles: [{ id: 'a-1' }, { id: 'a-2' }],
    });
    const result = await executeServerTool(
      { id: 'c3', name: 'save_articles', args: { article_ids: ['a-1', 'a-2', 'ghost'] } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(true);
    expect(result.undo).toEqual({
      tool: 'undo_save_articles',
      args: { article_ids: ['a-1', 'a-2'] },
    });
    // One INSERT per valid id, plus the validation SELECT.
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO article_read_state'));
    expect(inserts).toHaveLength(2);
    // Summary mentions the count + skipped marker.
    expect(result.summary).toContain('2');
    expect(result.summary).toMatch(/not found/);
  });
});

describe('react_to_articles tool', () => {
  it('rejects an invalid value', async () => {
    const { db } = makeFakeD1({ articles: [{ id: 'a-1' }] });
    const result = await executeServerTool(
      { id: 'c4', name: 'react_to_articles', args: { article_ids: ['a-1'], value: 0 } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(false);
  });

  it('rejects an empty article_ids array', async () => {
    const { db } = makeFakeD1({});
    const result = await executeServerTool(
      { id: 'c5', name: 'react_to_articles', args: { article_ids: [], value: 1 } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(false);
  });

  it('reports when no source articles match', async () => {
    const { db } = makeFakeD1({ sources: [] });
    const result = await executeServerTool(
      { id: 'c6', name: 'react_to_articles', args: { article_ids: ['ghost-1'], value: 1 } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(false);
    expect(result.summary).toMatch(/no articles/i);
  });

  it('inserts a reaction per matched article and returns an undo spec', async () => {
    const { db, calls } = makeFakeD1({
      sources: [
        { article_id: 'a-1', feed_id: 'f-1' },
        { article_id: 'a-2', feed_id: 'f-2' },
      ],
    });
    const result = await executeServerTool(
      { id: 'c7', name: 'react_to_articles', args: { article_ids: ['a-1', 'a-2'], value: -1 } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(true);
    expect(result.undo).toEqual({
      tool: 'undo_react_to_articles',
      args: { article_ids: ['a-1', 'a-2'] },
    });
    expect(result.summary).toMatch(/Disliked/);
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO article_reactions'));
    expect(inserts).toHaveLength(2);
  });

  it('uses a Liked summary on +1', async () => {
    const { db } = makeFakeD1({
      sources: [{ article_id: 'a-1', feed_id: 'f-1' }],
    });
    const result = await executeServerTool(
      { id: 'c8', name: 'react_to_articles', args: { article_ids: ['a-1'], value: 1 } },
      makeContext(db),
    );
    expect(result.succeeded).toBe(true);
    expect(result.summary).toMatch(/Liked/);
  });
});
