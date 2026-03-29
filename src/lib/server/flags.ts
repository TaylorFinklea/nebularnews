import type { Env } from './env';

const toBooleanFlag = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

export const isEventsV2Enabled = (env: Env) =>
  toBooleanFlag(env.EVENTS_V2_ENABLED, true);

export const isOptimisticMutationsEnabled = (env: Env) =>
  toBooleanFlag(env.OPTIMISTIC_MUTATIONS_ENABLED, true);

export const isJobBatchV2Enabled = (env: Env) =>
  toBooleanFlag(env.JOB_BATCH_V2_ENABLED, true);
