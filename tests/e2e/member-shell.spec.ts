import { expect, test } from '@playwright/test';

test('member application shell is available', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  await expect(page.getByRole('heading', { name: 'Log In' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
});
