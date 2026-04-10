import { DEFAULT_MODELS, type Provider } from './model-config';
import { dbGet } from '../db/helpers';

export interface ResolvedAIKey {
  provider: Provider;
  apiKey: string;
  model: string;
  isByok: boolean;
}

/**
 * Resolve which provider/key/model to use for a given user.
 *
 * Resolution order:
 * 0. BYOK: user-provided key in request header (x-user-api-key / x-user-api-provider).
 * 1. User's own key stored in D1 (provider_keys where user_id = userId).
 * 2. Global key stored in D1 (provider_keys where user_id IS NULL).
 * 3. Environment variable secrets (ANTHROPIC_API_KEY, then OPENAI_API_KEY).
 */
export async function resolveAIKey(
  db: D1Database,
  userId: string | null,
  req: Request,
  env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string },
): Promise<ResolvedAIKey | null> {
  // 0. Check for user-provided key in request header (BYOK from iOS Keychain).
  const userApiKey = req.headers.get('x-user-api-key');
  const userProvider = req.headers.get('x-user-api-provider');
  if (userApiKey && userProvider) {
    const provider: Provider = userProvider === 'openai' ? 'openai' : 'anthropic';
    return {
      provider,
      apiKey: userApiKey,
      model: DEFAULT_MODELS[provider],
      isByok: true,
    };
  }

  // 1. Try user's own key stored in D1.
  if (userId) {
    const userKey = await dbGet<{ provider: string; encrypted_key: string }>(
      db,
      `SELECT provider, encrypted_key FROM provider_keys WHERE user_id = ? LIMIT 1`,
      [userId],
    );

    if (userKey) {
      const provider: Provider = userKey.provider === 'openai' ? 'openai' : 'anthropic';
      return {
        provider,
        apiKey: userKey.encrypted_key,
        model: DEFAULT_MODELS[provider],
        isByok: true,
      };
    }
  }

  // 2. Fall back to global key (user_id IS NULL).
  const globalKey = await dbGet<{ provider: string; encrypted_key: string }>(
    db,
    `SELECT provider, encrypted_key FROM provider_keys WHERE user_id IS NULL LIMIT 1`,
  );

  if (globalKey) {
    const provider: Provider = globalKey.provider === 'openai' ? 'openai' : 'anthropic';
    return {
      provider,
      apiKey: globalKey.encrypted_key,
      model: DEFAULT_MODELS[provider],
      isByok: false,
    };
  }

  // 3. Fall back to environment variable secrets.
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: DEFAULT_MODELS.anthropic,
      isByok: false,
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: env.OPENAI_API_KEY,
      model: DEFAULT_MODELS.openai,
      isByok: false,
    };
  }

  return null;
}
