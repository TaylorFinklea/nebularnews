import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbRun } from '../db/helpers';

export const subscriptionRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// POST /subscription/verify — verify an App Store transaction
//
// Called by the iOS app after a successful StoreKit 2 purchase.
// Stores the subscription entitlement in D1 for server-side budget checks.
//
// In production, this should verify the transaction with Apple's
// App Store Server API. For now, we trust the client-provided data
// since the transaction was already verified by StoreKit 2 on-device.
// ---------------------------------------------------------------------------

subscriptionRoutes.post('/subscription/verify', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const body = await c.req.json<{
    product_id: string;
    transaction_id: string;
    original_transaction_id?: string;
    expires_at: number; // ms timestamp
  }>();

  if (!body.product_id || !body.transaction_id || !body.expires_at) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'Missing required fields' } }, 400);
  }

  // Map product ID to tier.
  const tierMap: Record<string, string> = {
    'com.nebularnews.ai.basic': 'basic',
    'com.nebularnews.ai.pro': 'pro',
  };
  const tier = tierMap[body.product_id];
  if (!tier) {
    return c.json({ ok: false, error: { code: 'invalid_product', message: 'Unknown product ID' } }, 400);
  }

  const now = Date.now();

  // Upsert subscription — user can only have one active subscription.
  const existing = await dbGet<{ id: string }>(
    db,
    `SELECT id FROM user_subscriptions WHERE user_id = ?`,
    [userId],
  );

  if (existing) {
    await dbRun(
      db,
      `UPDATE user_subscriptions
       SET tier = ?, expires_at = ?, transaction_id = ?, original_transaction_id = ?, updated_at = ?
       WHERE user_id = ?`,
      [tier, body.expires_at, body.transaction_id, body.original_transaction_id ?? null, now, userId],
    );
  } else {
    await dbRun(
      db,
      `INSERT INTO user_subscriptions (id, user_id, tier, expires_at, transaction_id, original_transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), userId, tier, body.expires_at, body.transaction_id, body.original_transaction_id ?? null, now, now],
    );
  }

  return c.json({ ok: true, data: { tier, expires_at: body.expires_at } });
});

// ---------------------------------------------------------------------------
// GET /subscription/status — check current subscription status
// ---------------------------------------------------------------------------

subscriptionRoutes.get('/subscription/status', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const sub = await dbGet<{
    tier: string;
    expires_at: number;
    created_at: number;
  }>(
    db,
    `SELECT tier, expires_at, created_at FROM user_subscriptions WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  if (!sub || sub.expires_at < Date.now()) {
    return c.json({ ok: true, data: { active: false, tier: null } });
  }

  return c.json({ ok: true, data: { active: true, tier: sub.tier, expires_at: sub.expires_at } });
});
