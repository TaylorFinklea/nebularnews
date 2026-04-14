import { nanoid } from 'nanoid';
import { dbGet, dbRun } from '../db/helpers';
import type { LlmUsage } from './ai';

// ---------------------------------------------------------------------------
// Record AI usage after every LLM call
// ---------------------------------------------------------------------------

export async function recordUsage(
  db: D1Database,
  userId: string,
  provider: string,
  model: string,
  usage: LlmUsage,
  endpoint: string,
  isByok: boolean,
): Promise<void> {
  const id = nanoid();
  const tokensInput = usage.prompt_tokens ?? 0;
  const tokensOutput = usage.completion_tokens ?? 0;

  await dbRun(
    db,
    `INSERT INTO ai_usage (id, user_id, provider, model, tokens_input, tokens_output, endpoint, is_byok, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, provider, model, tokensInput, tokensOutput, endpoint, isByok ? 1 : 0, Date.now()],
  );
}

// ---------------------------------------------------------------------------
// Check budget for subscription-tier users
// ---------------------------------------------------------------------------

export interface BudgetStatus {
  allowed: boolean;
  dailyUsed: number;
  dailyLimit: number;
  weeklyUsed: number;
  weeklyLimit: number;
  resetAt: number; // ms timestamp when daily budget resets
}

export async function checkBudget(
  db: D1Database,
  userId: string,
): Promise<BudgetStatus> {
  // Look up the user's subscription tier limits.
  const sub = await dbGet<{
    tier: string;
    daily_token_limit: number;
    weekly_token_limit: number;
  }>(
    db,
    `SELECT us.tier, st.daily_token_limit, st.weekly_token_limit
     FROM user_subscriptions us
     JOIN subscription_tiers st ON st.id = us.tier
     WHERE us.user_id = ? AND us.expires_at > ?
     LIMIT 1`,
    [userId, Date.now()],
  );

  // No subscription — no budget enforcement (will be caught at tier resolution).
  if (!sub) {
    return { allowed: true, dailyUsed: 0, dailyLimit: 0, weeklyUsed: 0, weeklyLimit: 0, resetAt: 0 };
  }

  const now = Date.now();
  const dayStart = now - 24 * 60 * 60 * 1000;
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  // Query daily and weekly usage in parallel.
  const [dailyRow, weeklyRow] = await Promise.all([
    dbGet<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) AS total
       FROM ai_usage
       WHERE user_id = ? AND is_byok = 0 AND created_at >= ?`,
      [userId, dayStart],
    ),
    dbGet<{ total: number }>(
      db,
      `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) AS total
       FROM ai_usage
       WHERE user_id = ? AND is_byok = 0 AND created_at >= ?`,
      [userId, weekStart],
    ),
  ]);

  const dailyUsed = dailyRow?.total ?? 0;
  const weeklyUsed = weeklyRow?.total ?? 0;

  // Check if user allows overages.
  const settings = await dbGet<{ allow_overages: number }>(
    db,
    `SELECT COALESCE(
       (SELECT value FROM settings WHERE user_id = ? AND key = 'allow_overages'),
       '0'
     ) AS allow_overages`,
    [userId],
  );
  const allowOverages = settings?.allow_overages === 1;

  const overDaily = dailyUsed >= sub.daily_token_limit;
  const overWeekly = weeklyUsed >= sub.weekly_token_limit;
  const overBudget = overDaily || overWeekly;

  // If over budget and overages not allowed, deny.
  const allowed = !overBudget || allowOverages;

  // Next daily reset is 24h from dayStart.
  const resetAt = dayStart + 24 * 60 * 60 * 1000;

  return {
    allowed,
    dailyUsed,
    dailyLimit: sub.daily_token_limit,
    weeklyUsed,
    weeklyLimit: sub.weekly_token_limit,
    resetAt,
  };
}

// ---------------------------------------------------------------------------
// Usage summary for the iOS Settings dashboard
// ---------------------------------------------------------------------------

export interface UsageSummary {
  daily: { used: number; limit: number };
  weekly: { used: number; limit: number };
  tier: string | null;
  allowOverages: boolean;
}

export async function getUsageSummary(
  db: D1Database,
  userId: string,
): Promise<UsageSummary> {
  const budget = await checkBudget(db, userId);

  const sub = await dbGet<{ tier: string }>(
    db,
    `SELECT tier FROM user_subscriptions WHERE user_id = ? AND expires_at > ? LIMIT 1`,
    [userId, Date.now()],
  );

  const settings = await dbGet<{ allow_overages: number }>(
    db,
    `SELECT COALESCE(
       (SELECT value FROM settings WHERE user_id = ? AND key = 'allow_overages'),
       '0'
     ) AS allow_overages`,
    [userId],
  );

  return {
    daily: { used: budget.dailyUsed, limit: budget.dailyLimit },
    weekly: { used: budget.weeklyUsed, limit: budget.weeklyLimit },
    tier: sub?.tier ?? null,
    allowOverages: settings?.allow_overages === 1,
  };
}
