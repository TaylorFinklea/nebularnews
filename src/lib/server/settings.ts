import { nanoid } from 'nanoid';
import { dbGet, dbRun, type Db } from './db';
import { decryptString, encryptString } from './crypto';
import type { Provider } from './llm';
import { now } from './db';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

const toReasoningEffort = (value: string | null): ReasoningEffort => {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return DEFAULT_REASONING_EFFORT;
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
  const provider = (await getSetting(db, 'default_provider')) ?? env.DEFAULT_PROVIDER ?? 'openai';
  const model = (await getSetting(db, 'default_model')) ?? env.DEFAULT_MODEL ?? 'gpt-4o-mini';
  const reasoningEffort = toReasoningEffort(
    (await getSetting(db, 'reasoning_effort')) ?? env.DEFAULT_REASONING_EFFORT ?? null
  );
  return { provider: provider as Provider, model, reasoningEffort };
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
