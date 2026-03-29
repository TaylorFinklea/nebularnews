import { nanoid } from 'nanoid';
import { dbAll, dbRun, getAffectedRows, now, type Db } from './db';
import type { Env } from './env';
import { createOpaqueToken, sha256Base64Url } from './oauth/crypto';
import { getPublicMobileResource } from './mobile/context';
import { MOBILE_DEFAULT_SCOPE } from './mobile/context';

const API_KEY_CLIENT_ID = 'api-key';
const API_KEY_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 years

export type ApiKeyInfo = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export async function generateApiKey(
  db: Db,
  env: Env,
  name?: string
): Promise<{ id: string; token: string; name: string; createdAt: number }> {
  const resource = getPublicMobileResource(env);
  if (!resource) {
    throw new Error('MOBILE_PUBLIC_BASE_URL is not configured. Set it in wrangler.toml or environment variables.');
  }

  const rawToken = 'nn_live_' + createOpaqueToken(32);
  const tokenHash = await sha256Base64Url(rawToken);
  const id = nanoid();
  const keyName = name?.trim() || 'API Key';
  const timestamp = now();

  await dbRun(
    db,
    `INSERT INTO oauth_access_tokens
       (id, token_hash, client_id, user_id, scope, resource, expires_at, revoked_at, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [id, tokenHash, API_KEY_CLIENT_ID, keyName, MOBILE_DEFAULT_SCOPE, resource, timestamp + API_KEY_TTL_MS, timestamp]
  );

  return { id, token: rawToken, name: keyName, createdAt: timestamp };
}

export async function listApiKeys(db: Db): Promise<ApiKeyInfo[]> {
  const rows = await dbAll<{
    id: string;
    user_id: string;
    created_at: number;
    last_used_at: number | null;
  }>(
    db,
    `SELECT id, user_id, created_at, last_used_at
     FROM oauth_access_tokens
     WHERE client_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [API_KEY_CLIENT_ID]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.user_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }));
}

export async function revokeApiKey(db: Db, keyId: string): Promise<boolean> {
  const result = await dbRun(
    db,
    'UPDATE oauth_access_tokens SET revoked_at = ? WHERE id = ? AND client_id = ? AND revoked_at IS NULL',
    [now(), keyId, API_KEY_CLIENT_ID]
  );
  return getAffectedRows(result) > 0;
}
