import { nanoid } from 'nanoid';
import { dbGet, dbRun, type Db } from './db';
import { decryptString, encryptString } from './crypto';
import type { Provider } from './llm';
import { now } from './db';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';
const DEFAULT_PROVIDER: Provider = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';

const toReasoningEffort = (value: string | null): ReasoningEffort => {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return DEFAULT_REASONING_EFFORT;
};

const toProvider = (value: string | null): Provider => {
  if (value === 'openai' || value === 'anthropic') return value;
  return DEFAULT_PROVIDER;
};

export type ProviderModelConfig = {
  provider: Provider;
  model: string;
  reasoningEffort: ReasoningEffort;
};

const getFirstSetting = async (db: Db, keys: string[]) => {
  for (const key of keys) {
    const value = await getSetting(db, key);
    if (value) return value;
  }
  return null;
};

export async function getSetting(db: Db, key: string) {
  const row = await dbGet<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string) {
  const existing = await dbGet<{ id: string }>(db, 'SELECT id FROM settings WHERE key = ?', [key]);
  if (existing) {
    await dbRun(db, 'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [value, now(), key]);
  } else {
    await dbRun(
      db,
      'INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)',
      [nanoid(), key, value, now()]
    );
  }
}

export async function getProviderModel(db: Db, env: App.Platform['env']) {
  return getIngestProviderModel(db, env);
}

export async function getIngestProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  const provider = toProvider(
    (await getFirstSetting(db, ['ingest_provider', 'default_provider'])) ??
      env.DEFAULT_INGEST_PROVIDER ??
      env.DEFAULT_PROVIDER ??
      null
  );
  const model =
    (await getFirstSetting(db, ['ingest_model', 'default_model'])) ??
    env.DEFAULT_INGEST_MODEL ??
    env.DEFAULT_MODEL ??
    DEFAULT_MODEL;
  const reasoningEffort = toReasoningEffort(
    (await getFirstSetting(db, ['ingest_reasoning_effort', 'reasoning_effort'])) ??
      env.DEFAULT_INGEST_REASONING_EFFORT ??
      env.DEFAULT_REASONING_EFFORT ??
      null
  );

  return { provider, model, reasoningEffort };
}

export async function getChatProviderModel(db: Db, env: App.Platform['env']): Promise<ProviderModelConfig> {
  const provider = toProvider(
    (await getFirstSetting(db, ['chat_provider', 'default_provider'])) ??
      env.DEFAULT_CHAT_PROVIDER ??
      env.DEFAULT_PROVIDER ??
      null
  );
  const model =
    (await getFirstSetting(db, ['chat_model', 'default_model'])) ??
    env.DEFAULT_CHAT_MODEL ??
    env.DEFAULT_MODEL ??
    DEFAULT_MODEL;
  const reasoningEffort = toReasoningEffort(
    (await getFirstSetting(db, ['chat_reasoning_effort', 'reasoning_effort'])) ??
      env.DEFAULT_CHAT_REASONING_EFFORT ??
      env.DEFAULT_REASONING_EFFORT ??
      null
  );

  return { provider, model, reasoningEffort };
}

export async function getProviderKey(db: Db, env: App.Platform['env'], provider: Provider) {
  const row = await dbGet<{ encrypted_key: string }>(db, 'SELECT encrypted_key FROM provider_keys WHERE provider = ?', [
    provider
  ]);
  if (!row) return null;
  return decryptString(row.encrypted_key, env.ENCRYPTION_KEY);
}

export async function setProviderKey(db: Db, env: App.Platform['env'], provider: Provider, apiKey: string) {
  const encrypted = await encryptString(apiKey, env.ENCRYPTION_KEY);
  const existing = await dbGet<{ id: string }>(db, 'SELECT id FROM provider_keys WHERE provider = ?', [provider]);
  if (existing) {
    await dbRun(
      db,
      'UPDATE provider_keys SET encrypted_key = ?, last_used_at = ?, status = ? WHERE provider = ?',
      [encrypted, now(), 'active', provider]
    );
  } else {
    await dbRun(
      db,
      'INSERT INTO provider_keys (id, provider, encrypted_key, created_at, last_used_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      [nanoid(), provider, encrypted, now(), now(), 'active']
    );
  }
}

export async function deleteProviderKey(db: Db, provider: Provider) {
  await dbRun(db, 'DELETE FROM provider_keys WHERE provider = ?', [provider]);
}
