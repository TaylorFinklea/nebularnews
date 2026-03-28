import { SignJWT, importPKCS8 } from 'jose';
import { dbAll, dbRun, type Db } from '../db';
import { logInfo, logWarn } from '../log';

type ApnsConfig = {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  sandbox: boolean;
};

type ApnsPayload = {
  alert: {
    title: string;
    body: string;
  };
  sound?: string;
  badge?: number;
  data?: Record<string, string>;
};

let cachedJwt: { token: string; expiresAt: number } | null = null;

const getApnsConfig = (env: App.Platform['env']): ApnsConfig | null => {
  const keyP8 = env.APNS_KEY_P8;
  const keyId = env.APNS_KEY_ID;
  const teamId = env.APNS_TEAM_ID;
  const bundleId = env.APNS_BUNDLE_ID ?? 'com.nebularnews.ios';

  if (!keyP8 || !keyId || !teamId) return null;

  const sandbox = env.APNS_SANDBOX !== 'false';
  return { keyP8, keyId, teamId, bundleId, sandbox };
};

const getApnsJwt = async (config: ApnsConfig): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);

  if (cachedJwt && cachedJwt.expiresAt > now + 60) {
    return cachedJwt.token;
  }

  const privateKey = await importPKCS8(config.keyP8, 'ES256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .sign(privateKey);

  cachedJwt = { token: jwt, expiresAt: now + 3500 };
  return jwt;
};

export const sendPushNotification = async (
  config: ApnsConfig,
  deviceToken: string,
  payload: ApnsPayload
): Promise<{ success: boolean; statusCode: number; reason?: string }> => {
  const jwt = await getApnsJwt(config);
  const host = config.sandbox
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';

  const apnsPayload = {
    aps: {
      alert: payload.alert,
      sound: payload.sound ?? 'default',
      ...(payload.badge !== undefined ? { badge: payload.badge } : {})
    },
    ...(payload.data ?? {})
  };

  const res = await fetch(`${host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      'authorization': `bearer ${jwt}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json'
    },
    body: JSON.stringify(apnsPayload)
  });

  if (res.ok) {
    return { success: true, statusCode: res.status };
  }

  const errorBody = await res.json().catch(() => ({})) as Record<string, unknown>;
  return {
    success: false,
    statusCode: res.status,
    reason: (typeof errorBody?.reason === 'string' ? errorBody.reason : null) ?? `HTTP ${res.status}`
  };
};

export const notifyUserDevices = async (
  db: Db,
  env: App.Platform['env'],
  userId: string,
  payload: ApnsPayload
): Promise<{ sent: number; failed: number; removed: number }> => {
  const config = getApnsConfig(env);
  if (!config) {
    logWarn('push.apns.not_configured', {});
    return { sent: 0, failed: 0, removed: 0 };
  }

  const tokens = await dbAll<{ id: string; token: string }>(
    db,
    'SELECT id, token FROM device_tokens WHERE platform = ? AND user_id = ?',
    ['ios', userId]
  );

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const invalidTokenIds: string[] = [];

  for (const { id, token } of tokens) {
    try {
      const result = await sendPushNotification(config, token, payload);
      if (result.success) {
        sent++;
      } else if (result.statusCode === 410 || result.reason === 'Unregistered' || result.reason === 'BadDeviceToken') {
        invalidTokenIds.push(id);
        removed++;
      } else {
        failed++;
        logWarn('push.apns.send_failed', { token: token.slice(0, 8), reason: result.reason });
      }
    } catch (err) {
      failed++;
      logWarn('push.apns.send_error', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  if (invalidTokenIds.length > 0) {
    for (const id of invalidTokenIds) {
      await dbRun(db, 'DELETE FROM device_tokens WHERE id = ?', [id]);
    }
    logInfo('push.apns.cleaned_invalid_tokens', { count: invalidTokenIds.length });
  }

  logInfo('push.apns.batch_complete', { userId, sent, failed, removed, total: tokens.length });
  return { sent, failed, removed };
};

export const notifyAllDevices = async (
  db: Db,
  env: App.Platform['env'],
  payload: ApnsPayload
): Promise<{ sent: number; failed: number; removed: number }> => {
  const config = getApnsConfig(env);
  if (!config) {
    logWarn('push.apns.not_configured', {});
    return { sent: 0, failed: 0, removed: 0 };
  }

  const tokens = await dbAll<{ id: string; token: string }>(
    db,
    'SELECT id, token FROM device_tokens WHERE platform = ?',
    ['ios']
  );

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const invalidTokenIds: string[] = [];

  for (const { id, token } of tokens) {
    try {
      const result = await sendPushNotification(config, token, payload);
      if (result.success) {
        sent++;
      } else if (result.statusCode === 410 || result.reason === 'Unregistered' || result.reason === 'BadDeviceToken') {
        invalidTokenIds.push(id);
        removed++;
      } else {
        failed++;
        logWarn('push.apns.send_failed', { token: token.slice(0, 8), reason: result.reason });
      }
    } catch (err) {
      failed++;
      logWarn('push.apns.send_error', { error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  if (invalidTokenIds.length > 0) {
    for (const id of invalidTokenIds) {
      await dbRun(db, 'DELETE FROM device_tokens WHERE id = ?', [id]);
    }
    logInfo('push.apns.cleaned_invalid_tokens', { count: invalidTokenIds.length });
  }

  logInfo('push.apns.batch_complete', { sent, failed, removed, total: tokens.length });
  return { sent, failed, removed };
};
