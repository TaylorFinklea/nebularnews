import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from '../env';
import { dbAll } from '../db/helpers';

/**
 * Send an APNS push notification to a user's registered devices.
 */
export async function sendPushToUser(
  db: D1Database,
  env: Env,
  userId: string,
  payload: { title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  if (!env.APNS_KEY_P8) {
    console.warn('[apns] No APNS_KEY_P8 configured, skipping push');
    return;
  }

  const tokens = await dbAll<{ token: string }>(
    db,
    `SELECT token FROM device_tokens WHERE user_id = ?`,
    [userId],
  );

  if (tokens.length === 0) return;

  const jwt = await createApnsJwt(env);
  const isSandbox = env.APNS_SANDBOX === 'true';
  const host = isSandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

  const apnsPayload = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    },
    ...payload.data,
  });

  for (const { token } of tokens) {
    try {
      const res = await fetch(`https://${host}/3/device/${token}`, {
        method: 'POST',
        headers: {
          Authorization: `bearer ${jwt}`,
          'apns-topic': env.APNS_BUNDLE_ID,
          'apns-push-type': 'alert',
          'apns-priority': '5',
        },
        body: apnsPayload,
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[apns] Push failed for ${token.slice(0, 8)}...: ${res.status} ${body}`);
      }
    } catch (err) {
      console.error(`[apns] Push error for ${token.slice(0, 8)}...:`, err);
    }
  }
}

async function createApnsJwt(env: Env): Promise<string> {
  const privateKey = await importPKCS8(env.APNS_KEY_P8!, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APNS_KEY_ID })
    .setIssuer(env.APNS_TEAM_ID)
    .setIssuedAt()
    .sign(privateKey);
}
