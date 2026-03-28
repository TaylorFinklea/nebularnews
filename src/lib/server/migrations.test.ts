import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockDbState = {
  tables: Map<string, string[]>;
  schemaVersions: Map<number, { name: string; appliedAt: number }>;
  tagKeys: Set<string>;
};

type MockDb = {
  __state: MockDbState;
  prepare(sql: string): any;
};

/** Track the most recently created mock db so the dbGet mock can route queries to its state. */
let activeMockDb: MockDb | null = null;

vi.mock('./db', () => ({
  dbRun: vi.fn(async (_db: any, sql: string, params: unknown[] = []) => {
    const state: MockDbState | undefined = _db?.__state ?? activeMockDb?.__state;
    if (!state) return { meta: { changes: 0 } };

    // markVersionApplied
    if (sql.includes('INSERT INTO schema_migrations')) {
      const version = Number(params[0]);
      const name = String(params[1]);
      const appliedAt = Number(params[2]);
      state.schemaVersions.set(version, { name, appliedAt });
    }

    // runSafe CREATE TABLE — track new tables
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
    if (createMatch) {
      const tableName = createMatch[1];
      if (!state.tables.has(tableName)) state.tables.set(tableName, []);
    }

    // runSafe ALTER TABLE ADD COLUMN
    const alterMatch = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
    if (alterMatch) {
      const [, tableName, colName] = alterMatch;
      const cols = state.tables.get(tableName) ?? [];
      if (!cols.includes(colName)) cols.push(colName);
      state.tables.set(tableName, cols);
    }

    // Tag seeding — capture name_normalized (params[2]) for test assertions
    if (sql.includes('INSERT INTO tags') && sql.includes('ON CONFLICT DO NOTHING')) {
      const nameNormalized = String(params[2] ?? '');
      if (nameNormalized) state.tagKeys.add(nameNormalized);
    }

    return { meta: { changes: 1 } };
  }),
  dbGet: vi.fn(async (db: any, sql: string, params: unknown[] = []) => {
    const state: MockDbState | undefined = db?.__state ?? activeMockDb?.__state;
    if (!state) return null;

    // getSchemaVersion query
    if (sql.includes('SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations')) {
      const applied = [...state.schemaVersions.keys()];
      return { version: applied.length ? Math.max(...applied) : 0 };
    }

    // tableExists: information_schema.tables
    if (sql.includes('information_schema.tables') && sql.includes('table_name')) {
      const tableName = String(params[0] ?? '');
      return state.tables.has(tableName) ? { name: tableName } : null;
    }

    // columnExists: information_schema.columns
    if (sql.includes('information_schema.columns') && sql.includes('column_name')) {
      const tableName = String(params[0] ?? '');
      const columnName = String(params[1] ?? '');
      const columns = state.tables.get(tableName) ?? [];
      return columns.includes(columnName) ? { name: columnName } : null;
    }

    return null;
  })
}));

const createMockDb = ({
  version,
  includeReactionReasons,
  includeNewsBriefEditions,
  includeOAuthTables
}: {
  version: number;
  includeReactionReasons: boolean;
  includeNewsBriefEditions?: boolean;
  includeOAuthTables?: boolean;
}): MockDb => {
  const tables = new Map<string, string[]>();
  const addTable = (name: string, columns: string[]) => tables.set(name, [...columns]);

  addTable('schema_migrations', ['version', 'name', 'applied_at']);
  addTable('jobs', ['id', 'type', 'article_id', 'status', 'priority', 'locked_by', 'locked_at', 'lease_expires_at', 'created_at', 'updated_at']);
  addTable('provider_keys', ['id', 'provider', 'encrypted_key', 'key_version', 'created_at', 'last_used_at', 'status']);
  addTable('articles', ['id', 'canonical_url', 'image_url', 'image_status', 'image_checked_at', 'search_vector']);
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
  addTable('tags', ['id', 'name', 'name_normalized', 'slug', 'color', 'description', 'created_at', 'updated_at']);
  addTable('article_tags', ['id', 'article_id', 'tag_id', 'source', 'confidence', 'created_at', 'updated_at']);
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
  if (includeOAuthTables) {
    addTable('oauth_clients', [
      'client_id',
      'client_name',
      'redirect_uris_json',
      'grant_types_json',
      'response_types_json',
      'token_endpoint_auth_method',
      'scope',
      'created_at',
      'updated_at',
      'last_used_at'
    ]);
    addTable('oauth_consents', [
      'id',
      'client_id',
      'user_id',
      'scope',
      'granted_at',
      'revoked_at',
      'created_at',
      'updated_at'
    ]);
    addTable('oauth_authorization_codes', [
      'id',
      'code_hash',
      'client_id',
      'user_id',
      'redirect_uri',
      'scope',
      'resource',
      'code_challenge',
      'code_challenge_method',
      'expires_at',
      'used_at',
      'created_at'
    ]);
    addTable('oauth_access_tokens', [
      'id',
      'token_hash',
      'client_id',
      'user_id',
      'scope',
      'resource',
      'expires_at',
      'revoked_at',
      'created_at',
      'last_used_at'
    ]);
    addTable('oauth_refresh_tokens', [
      'id',
      'token_hash',
      'client_id',
      'user_id',
      'scope',
      'resource',
      'expires_at',
      'revoked_at',
      'rotated_from_id',
      'created_at',
      'last_used_at'
    ]);
  }

  const schemaVersions = new Map<number, { name: string; appliedAt: number }>();
  schemaVersions.set(version, { name: `v${version}`, appliedAt: Date.now() });

  const state: MockDbState = {
    tables,
    schemaVersions,
    tagKeys: new Set()
  };

  const db: MockDb = {
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

          if (sql.startsWith('INSERT INTO tags') && sql.includes('ON CONFLICT DO NOTHING')) {
            const [, , nameNormalized] = params as [string, string, string];
            state.tagKeys.add(nameNormalized);
            return { success: true };
          }

          return { success: true };
        }
      };

      return statement;
    }
  };

  activeMockDb = db;
  return db;
};

describe('migrations', () => {
  beforeEach(() => {
    vi.resetModules();
    activeMockDb = null;
  });

  it('applies schema v13 cleanly on a v8 database', async () => {
    const db = createMockDb({
      version: 8,
      includeReactionReasons: true,
      includeNewsBriefEditions: false,
      includeOAuthTables: false
    });
    const { ensureSchema, getSchemaVersion, assertSchemaVersion } = await import('./migrations');

    await ensureSchema(db as any);

    expect(await getSchemaVersion(db as any)).toBe(17);
    expect(db.__state.tables.has('article_search')).toBe(true);
    expect(db.__state.tables.has('news_brief_editions')).toBe(true);
    expect(db.__state.tables.has('oauth_clients')).toBe(true);
    await expect(assertSchemaVersion(db as any)).resolves.toBe(17);
  });

  it('applies schema v13 cleanly on a v7 database', async () => {
    const db = createMockDb({
      version: 7,
      includeReactionReasons: true,
      includeNewsBriefEditions: false,
      includeOAuthTables: false
    });
    const { ensureSchema, getSchemaVersion, assertSchemaVersion } = await import('./migrations');

    await ensureSchema(db as any);

    expect(await getSchemaVersion(db as any)).toBe(17);
    expect(db.__state.tables.get('article_scores')).toEqual(
      expect.arrayContaining(['score_status', 'confidence', 'preference_confidence', 'weighted_average'])
    );
    await expect(assertSchemaVersion(db as any)).resolves.toBe(17);
  });

  it('keeps reaction-reason migration compatible from v6', async () => {
    const db = createMockDb({
      version: 6,
      includeReactionReasons: false,
      includeNewsBriefEditions: false,
      includeOAuthTables: false
    });
    const { ensureSchema, getSchemaVersion, assertSchemaVersion } = await import('./migrations');

    await ensureSchema(db as any);

    expect(await getSchemaVersion(db as any)).toBe(17);
    expect(db.__state.tables.has('article_reaction_reasons')).toBe(true);
    await expect(assertSchemaVersion(db as any)).resolves.toBe(17);
  });

  it('seeds the starter tag taxonomy exactly once', async () => {
    const db = createMockDb({
      version: 10,
      includeReactionReasons: true,
      includeNewsBriefEditions: true,
      includeOAuthTables: false
    });
    const { ensureSchema } = await import('./migrations');

    await ensureSchema(db as any);
    await ensureSchema(db as any);

    expect(db.__state.tagKeys.size).toBe(24);
    expect(db.__state.tagKeys.has('kubernetes')).toBe(true);
    expect(db.__state.tagKeys.has('large language models')).toBe(true);
  });

  it('fails schema assertion when article_reaction_reasons is missing at v12', async () => {
    const db = createMockDb({
      version: 12,
      includeReactionReasons: false,
      includeNewsBriefEditions: true,
      includeOAuthTables: true
    });
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db as any, 12)).rejects.toThrow('Missing required table: article_reaction_reasons');
  });

  it('fails schema assertion when score status columns are missing at v12', async () => {
    const db = createMockDb({
      version: 12,
      includeReactionReasons: true,
      includeNewsBriefEditions: true,
      includeOAuthTables: true
    });
    const articleScoresColumns = db.__state.tables.get('article_scores') ?? [];
    db.__state.tables.set(
      'article_scores',
      articleScoresColumns.filter((name) => name !== 'score_status')
    );
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db as any, 12)).rejects.toThrow('Missing required article_scores column: score_status');
  });

  it('fails schema assertion when search_vector column is missing at v12', async () => {
    const db = createMockDb({
      version: 12,
      includeReactionReasons: true,
      includeNewsBriefEditions: true,
      includeOAuthTables: true
    });
    // Remove search_vector from articles columns (the V9 assertion now checks for this column)
    const articlesColumns = db.__state.tables.get('articles') ?? [];
    db.__state.tables.set(
      'articles',
      articlesColumns.filter((name) => name !== 'search_vector')
    );
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db as any, 12)).rejects.toThrow('Missing required articles column: search_vector');
  });

  it('fails schema assertion when news_brief_editions is missing at v12', async () => {
    const db = createMockDb({
      version: 12,
      includeReactionReasons: true,
      includeNewsBriefEditions: false,
      includeOAuthTables: true
    });
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db as any, 12)).rejects.toThrow('Missing required table: news_brief_editions');
  });

  it('fails schema assertion when oauth_clients is missing at v12', async () => {
    const db = createMockDb({
      version: 12,
      includeReactionReasons: true,
      includeNewsBriefEditions: true,
      includeOAuthTables: true
    });
    db.__state.tables.delete('oauth_clients');
    const { assertSchemaVersion } = await import('./migrations');

    await expect(assertSchemaVersion(db as any, 12)).rejects.toThrow('Missing required table: oauth_clients');
  });
});
