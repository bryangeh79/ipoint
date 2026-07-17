import { expect, test } from '@playwright/test';

test.describe('merchant workspace', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('covers onboarding, suspended, MCP, and responsive navigation states', async ({
    page,
  }) => {
    await page.goto('http://127.0.0.1:4174');
    await expect(
      page.getByRole('heading', { name: 'Good afternoon, Northstar Coffee' }),
    ).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveAttribute('value', '60');
    await page.getByRole('button', { name: 'Preview suspended state' }).click();
    await expect(page.getByRole('alert')).toContainText('read-only');
    await page.getByRole('link', { name: 'MCP' }).last().click();
    await expect(
      page.getByRole('heading', { name: 'MCP account' }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Ledger' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('renders loading, error, empty, offline, permission, and expired boundaries', async ({
    page,
  }) => {
    const boundaries = {
      loading: 'Loading merchant workspace',
      error: 'Unable to load the workspace',
      empty: 'No merchant data yet',
      offline: 'You are offline',
      forbidden: 'Permission denied',
      expired: 'Session expired',
    } as const;

    for (const [state, accessibleName] of Object.entries(boundaries)) {
      await page.goto(`http://127.0.0.1:4174/?state=${state}`);
      await expect(
        state === 'loading'
          ? page.getByRole('region', { name: accessibleName })
          : page.getByText(accessibleName, { exact: true }),
      ).toBeVisible();
    }
  });
});

test.describe('admin workspace', () => {
  test('covers merchant search, independent review, package, MCP, and audit views', async ({
    page,
  }) => {
    await page.goto('http://127.0.0.1:4175');
    await page.getByRole('link', { name: 'Merchants' }).click();
    await page
      .getByRole('searchbox', { name: 'Search merchants' })
      .fill('Northstar');
    await expect(page.getByRole('table')).toContainText('MY-OF-000127');
    await page.getByRole('link', { name: /Reviews/u }).click();
    await page.getByRole('tab', { name: 'KYC review' }).click();
    await expect(page.getByRole('table')).toContainText('Previous version');
    await page.getByRole('link', { name: 'MCP' }).click();
    await page.getByRole('tab', { name: 'Maker / Checker' }).click();
    await expect(
      page.getByRole('button', { name: 'Execute exactly once' }),
    ).toBeEnabled();
    await page.getByRole('link', { name: 'Audit' }).click();
    await expect(
      page.getByRole('heading', { name: 'Audit log and entity timeline' }),
    ).toBeVisible();
  });

  test('exposes a keyboard-reachable skip link and no horizontal page overflow', async ({
    page,
  }) => {
    await page.goto('http://127.0.0.1:4175');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to main content' }),
    ).toBeFocused();
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
});
