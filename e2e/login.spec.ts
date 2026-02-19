import { expect, test } from '@playwright/test';

test('wrong password returns auth error and does not render 500 page', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill(`wrong-${Date.now()}`);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '500' })).toHaveCount(0);
  await expect(page.getByText(/Invalid password|Too many attempts|Authentication service unavailable/)).toBeVisible();
});

test('correct password redirects to dashboard', async ({ page }) => {
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!password, 'Set E2E_ADMIN_PASSWORD to run successful login test.');

  await page.goto('/login');
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '500' })).toHaveCount(0);
});
