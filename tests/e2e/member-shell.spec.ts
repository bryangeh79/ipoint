import { expect, test } from '@playwright/test';

test('member application shell is available', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Member workspace' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }).first(),
  ).toBeVisible();
  await expect(page.getByRole('main')).toContainText(
    'Business modules remain intentionally outside this foundation phase.',
  );
});
