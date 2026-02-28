import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SESSION_COOKIE = 'nn_session';
const CSRF_COOKIE = 'nn_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

type ViewportSize = { width: number; height: number };

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
    const currentKey = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (currentKey === key) return value;
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

const authenticate = async (page: Page, baseURL: string) => {
  const secret = process.env.SESSION_SECRET ?? readDevVar('SESSION_SECRET');
  test.skip(!secret, 'Missing SESSION_SECRET. Set env var or add it to .dev.vars.');

  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: createSessionValue(secret!),
      url: baseURL
    },
    {
      name: CSRF_COOKIE,
      value: 'e2e-csrf-token',
      url: baseURL
    }
  ]);
};

const openFirstArticle = async (page: Page) => {
  await page.goto('/articles');
  await expect(page).toHaveURL(/\/articles/);

  const links = page.locator('a[href^="/articles/"]');
  const count = await links.count();
  test.skip(count === 0, 'No article links available for article detail layout test.');

  await links.first().click();
  await expect(page).toHaveURL(/\/articles\/.+/);
};

const expectNoHorizontalOverflow = async (page: Page, viewport: ViewportSize) => {
  await page.setViewportSize(viewport);
  await page.waitForLoadState('networkidle');

  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth + 1;
  });
  expect(hasOverflow).toBe(false);

  const titleBox = await page.locator('h1').first().boundingBox();
  expect(titleBox).not.toBeNull();
  expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
};

test('article detail stays within mobile bounds and utilities sheet remains usable', async ({ page, baseURL }) => {
  test.skip(!baseURL, 'Missing baseURL.');
  await authenticate(page, baseURL!);
  await openFirstArticle(page);

  await expectNoHorizontalOverflow(page, { width: 320, height: 820 });
  await expectNoHorizontalOverflow(page, { width: 390, height: 844 });

  const utilitiesButton = page.getByRole('button', { name: 'Open utilities' });
  await expect(utilitiesButton).toBeVisible();
  await utilitiesButton.click();

  const dialog = page.getByRole('dialog', { name: 'Utilities' });
  await expect(dialog).toBeVisible();

  const paddingBottom = await dialog.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom || '0'));
  expect(paddingBottom).toBeGreaterThan(60);

  await page.getByRole('button', { name: /Tags/i }).click();
  const tagChips = dialog.locator('.tag-chip');
  const tagCount = await tagChips.count();
  if (tagCount > 0) {
    const firstChipBox = await tagChips.first().boundingBox();
    expect(firstChipBox).not.toBeNull();
    expect((firstChipBox?.x ?? 0) + (firstChipBox?.width ?? 0)).toBeLessThanOrEqual(390 + 1);
  }
});
