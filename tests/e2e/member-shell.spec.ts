import { expect, test } from '@playwright/test';

test('member application shell is available', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'iPoint Member' }),
  ).toBeVisible();
});
