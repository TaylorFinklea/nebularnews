import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const SESSION_COOKIE = 'nn_session';
const CSRF_COOKIE = 'nn_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TRACKER_KEY = 'nebular:manual-pull-in-progress';
const RUNNING_POLL_RESPONSES = 12;

test.setTimeout(120_000);

type PullState = {
  inProgress: boolean;
  startedAt: number | null;
  completedAt: number | null;
  lastRunStatus: 'success' | 'failed' | null;
  lastError: string | null;
};

const readDevVar = (key: string): string | null => {
  const devVarsPath = resolve(process.cwd(), '.dev.vars');
  if (!existsSync(devVarsPath)) return null;
  const raw = readFileSync(devVarsPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    if (k === key) return v;
  }
  return null;
};

const createSessionValue = (secret: string) => {
  const payload = JSON.stringify({
    userId: 'admin',
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64');
  return `${payloadB64}.${signature}`;
};

test('manual pull status persists across refresh/navigation and clears on completion', async ({ context, page, baseURL }) => {
  const secret = process.env.SESSION_SECRET ?? readDevVar('SESSION_SECRET');
  test.skip(!secret, 'Missing SESSION_SECRET. Set env var or add it to .dev.vars.');
  test.skip(!baseURL, 'Missing baseURL.');

  let runStartedAt: number | null = null;
  let getCallsSinceStart = 0;
  let started = false;
  await page.route('**/api/pull*', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'POST' && url.pathname === '/api/pull') {
      started = true;
      runStartedAt = Date.now();
      getCallsSinceStart = 0;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, cycles: 3, started: true, run_id: 'run-1' })
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/pull/status') {
      let payload: PullState;
      if (!started || runStartedAt === null) {
        payload = {
          inProgress: false,
          startedAt: null,
          completedAt: null,
          lastRunStatus: null,
          lastError: null
        };
      } else {
        getCallsSinceStart += 1;
        if (getCallsSinceStart <= RUNNING_POLL_RESPONSES) {
          payload = {
            inProgress: true,
            startedAt: runStartedAt,
            completedAt: null,
            lastRunStatus: null,
            lastError: null
          };
        } else {
          payload = {
            inProgress: false,
            startedAt: null,
            completedAt: runStartedAt + 5_000,
            lastRunStatus: 'success',
            lastError: null
          };
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          run_id: 'run-1',
          status: payload.inProgress ? 'running' : payload.lastRunStatus ?? 'success',
          in_progress: payload.inProgress,
          started_at: payload.startedAt,
          completed_at: payload.completedAt,
          last_run_status: payload.lastRunStatus,
          last_error: payload.lastError
        })
      });
      return;
    }

    await route.fallback();
  });

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: createSessionValue(secret!),
      url: baseURL!
    },
    {
      name: CSRF_COOKIE,
      value: 'e2e-csrf-token',
      url: baseURL!
    }
  ]);

  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);

  await page.evaluate((key) => sessionStorage.removeItem(key), TRACKER_KEY);
  await page.reload();

  const pullButton = page.locator('.dev-tools .icon-button').first();
  await expect(pullButton).toBeVisible();
  await pullButton.click();
  await expect(pullButton).toHaveAttribute('aria-label', 'Pulling now');
  await expect(pullButton).toBeDisabled();

  await page.reload();
  await page.goto('/articles');
  await page.goto('/');
  await expect(pullButton).toHaveAttribute('aria-label', 'Pulling now');
  await expect(pullButton).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Pulling feeds now');

  await expect
    .poll(async () => await pullButton.getAttribute('aria-label'), { timeout: 30_000, intervals: [500, 1_000] })
    .toBe('Pull now');
  await expect(pullButton).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('Pull complete');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), TRACKER_KEY)).toBeNull();
});
