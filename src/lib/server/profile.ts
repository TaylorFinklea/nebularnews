import { nanoid } from 'nanoid';
import { dbGet, dbRun, now, type Db } from './db';

export type PreferenceProfile = {
  id: string;
  profile_text: string;
  updated_at: number;
  version: number;
};

const DEFAULT_PROFILE =
  'Prefers timely, actionable, and well-sourced technology and product news. Avoids fluff and shallow rehashes.';

export async function ensurePreferenceProfile(db: Db): Promise<PreferenceProfile> {
  const current = await dbGet<PreferenceProfile>(
    db,
    'SELECT id, profile_text, updated_at, version FROM preference_profile LIMIT 1'
  );
  if (current) return current;
  const id = nanoid();
  const profile_text = DEFAULT_PROFILE;
  const updated_at = now();
  const version = 1;
  await dbRun(
    db,
    'INSERT INTO preference_profile (id, profile_text, updated_at, version) VALUES (?, ?, ?, ?)',
    [id, profile_text, updated_at, version]
  );
  return { id, profile_text, updated_at, version };
}

export async function updatePreferenceProfile(db: Db, id: string, profile_text: string) {
  await dbRun(
    db,
    'UPDATE preference_profile SET profile_text = ?, updated_at = ?, version = version + 1 WHERE id = ?',
    [profile_text, now(), id]
  );
}
