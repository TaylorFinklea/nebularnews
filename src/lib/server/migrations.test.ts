import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockDbState = {
  tables: Map<string, string[]>;
  schemaVersions: Map<number, { name: string; appliedAt: number }>;
};

type MockDb = D1Database & {
  __state: MockDbState;
};

const createMockDb = ({
  version,
  includeReactionReasons,
  includeNewsBriefEditions
}: {
  version: number;
  includeReactionReasons: boolean;
  includeNewsBriefEditions?: boolean;
}): MockDb => {
  const tables = new Map<string, string[]>();
  const addTable = (name: string, columns: string[]) => tables.set(name, [...columns]);

  addTable('schema_migrations', ['version', 'name', 'applied_at']);
  addTable('jobs', ['id', 'type', 'article_id', 'status', 'priority', 'locked_by', 'locked_at', 'lease_expires_at', 'created_at', 'updated_at']);
  addTable('provider_keys', ['id', 'provider', 'encrypted_key', 'key_version', 'created_at', 'last_used_at', 'status']);
  addTable('articles', ['id', 'canonical_url', 'image_url', 'image_status', 'image_checked_at']);
  addTable('pull_runs', ['id']);
  addTable('job_runs', ['id', 'job_id']);
  addTable('auth_attempts', ['id', 'identifier']);
  addTable('audit_log', ['id', 'actor']);
  addTable('article_tag_suggestions', ['id', 'article_id']);
  addTable('article_tag_suggestion_dismissals', ['article_id', 'name_normalized']);
  const articleScoreColumns = ['id', 'article_id', 'score', 'label', 'reason_text', 'evidence_json', 'created_at', 'profile_version'];
  if (version >= 6) {
    articleScoreColumns.push('scoring_method');
  }
  if (version >= 8) {
    articleScoreColumns.push('score_status', 'confidence', 'preference_confidence', 'weighted_average');
  }
  addTable('article_scores', articleScoreColumns);
  addTable('article_search', ['article_id', 'title', 'content_text', 'summary_text']);
  if (includeReactionReasons) {
    addTable('article_reaction_reasons', ['article_id', 'reason_code', 'created_at']);
  }
  if (includeNewsBriefEditions) {
    addTable('news_brief_editions', [
      'id',
      'edition_key',
      'edition_kind',
      'edition_slot',
      'timezone',
      'scheduled_for',
      'window_start',
      'window_end',
      'score_cutoff',
      'status',
      'candidate_count',
      'bullets_json',
      'source_article_ids_json',
      'provider',
      'model',
      'last_error',
      'attempts',
      'locked_by',
      'locked_at',
      'lease_expires_at',
      'run_after',
      'generated_at',
      'created_at',
      'updated_at'
    ]);
  }

  const schemaVersions = new Map<number, { name: string; appliedAt: number }>();
  schemaVersions.set(version, { name: `v${version}`, appliedAt: Date.now() });

  const state: MockDbState = {
    tables,
    schemaVersions
  };

  return {
    __state: state,
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          params = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations')) {
            const applied = [...state.schemaVersions.keys()];
            return { version: applied.length ? Math.max(...applied) : 0 } as T;
          }

          if (sql.includes("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")) {
            const tableName = String(params[0] ?? '');
            return (state.tables.has(tableName) ? { name: tableName } : null) as T | null;
          }

          return null as T | null;
        },
        async all<T>() {
          const pragmaMatch = sql.match(/^PRAGMA table_info\((.+)\)$/);
          if (pragmaMatch) {
            const tableName = pragmaMatch[1];
            const columns = state.tables.get(tableName) ?? [];
            return {
              results: columns.map((name) => ({ name }))
            } as { results: T[] };
          }

          return { results: [] as T[] };
        },
        async run() {
          if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) {
            const tableMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_]+)/);
            const tableName = tableMatch?.[1];
            if (tableName && !state.tables.has(tableName)) {
              const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
              const columns = body
                .split('\n')
                .map((line) => line.trim().replace(/,$/, ''))
                .filter((line) => line && !line.startsWith('PRIMARY KEY') && !line.startsWith('FOREIGN KEY'))
                .map((line) => line.split(/\s+/)[0]);
              state.tables.set(tableName, columns);
            }
            return { success: true };
          }

          if (sql.startsWith('CREATE VIRTUAL TABLE IF NOT EXISTS')) {
            const tableMatch = sql.match(/CREATE VIRTUAL TABLE IF NOT EXISTS\s+([a-zA-Z_]+)/);
            const tableName = tableMatch?.[1];
            if (tableName && !state.tables.has(tableName)) {
              const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
              const columns = body
                .split('\n')
                .map((line) => line.trim().replace(/,$/, ''))
                .filter((line) => line && !line.startsWith('tokenize'))
                .map((line) => line.split(/\s+/)[0]);
              state.tables.set(tableName, columns);
            }
            return { success: true };
          }

          if (sql.startsWith('ALTER TABLE')) {
            const alterMatch = sql.match(/ALTER TABLE\s+([a-zA-Z_]+)\s+ADD COLUMN\s+([a-zA-Z_]+)/);
            const tableName = alterMatch?.[1];
            const columnName = alterMatch?.[2];
            if (tableName && columnName) {
              const existing = state.tables.get(tableName) ?? [];
              if (!existing.includes(columnName)) {
                state.tables.set(tableName, [...existing, columnName]);
              }
            }
            return { success: true };
          }

          if (sql.startsWith('INSERT INTO schema_migrations')) {
            const [nextVersion, name, appliedAt] = params as [number, string, number];
            state.schemaVersions.set(nextVersion, { name, appliedAt });
            return { success: true };
          }

          return { success: true };
        }
      };

      return statement;
    }
  } as MockDb;
};

describe('migrations', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('applies schema v10 cleanly on a v8 database', async () => {
    const db = createMockDb({ version: 8, includeReactionReasons: true, includeNewsBriefEditions: false });
    const { ensureSchema, getSchemaVersion, assertSchemaVersion } = await import('./migrations');

    await ensureSchema(db);

    expect(await getSchemaVersion(db)).toBe(10);
    expect(db.__state.tables.has('article_search')).toBe(true);
    expect(db.__state.tables.has('news_brief_editions')).toBe(true);
    await expect(assertSchemaVersion(db)).resolves.toBe(10);
  });

  it('applies schema v10 cleanly on a v7 database', async () => {
    const db = createMockDb({ version: 7, includeReactionReasons: true, includeNewsBriefEditions: false });
    const { ensureSchema, getSchemaVersion, assertSchemaVersion } = await import('./migrations');

    await ensureSchema(db);

    expect(await getSchemaVersion(db)).toBe(10);
    expect(db.__state.tables.get('article_scores')).toEqual(
      expect.arrayContaining(['score_status', 'confidence', 'preference_confidence', 'weighted_average'])
    );
    await expect(assertSchemaVersion(db)).resolves.toBe(10);
  });

  it('keeps reaction-reason migration compatible from v6', async () => {
    const db = createMockDb({ version: 6, includeReactionReasons: false, includeNewsBriefEditions: false });
    const { ensureSchema, getSchemaVersion, assertSchemaVersion } = await import('./migrations');

    await ensureSchema(db);

    expect(await getSchemaVersion(db)).toBe(10);
    expect(db.__state.tables.has('article_reaction_reasons')).toBe(true);
    await expect(assertSchemaVersion(db)).resolves.toBe(10);
  });

  it('fails schema assertion when article_reaction_reasons is missing at v10', async () => {
    const db = createMockDb({ version: 10, includeReactionReasons: false, includeNewsBriefEditions: true });
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db)).rejects.toThrow('Missing required table: article_reaction_reasons');
  });

  it('fails schema assertion when score status columns are missing at v10', async () => {
    const db = createMockDb({ version: 10, includeReactionReasons: true, includeNewsBriefEditions: true });
    const articleScoresColumns = db.__state.tables.get('article_scores') ?? [];
    db.__state.tables.set(
      'article_scores',
      articleScoresColumns.filter((name) => name !== 'score_status')
    );
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db)).rejects.toThrow('Missing required article_scores column: score_status');
  });

  it('fails schema assertion when article_search is missing at v10', async () => {
    const db = createMockDb({ version: 10, includeReactionReasons: true, includeNewsBriefEditions: true });
    db.__state.tables.delete('article_search');
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db)).rejects.toThrow('Missing required table: article_search');
  });

  it('fails schema assertion when news_brief_editions is missing at v10', async () => {
    const db = createMockDb({ version: 10, includeReactionReasons: true, includeNewsBriefEditions: false });
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db)).rejects.toThrow('Missing required table: news_brief_editions');
  });
});
