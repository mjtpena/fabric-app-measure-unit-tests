import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('Short circuit explains the renamed measure and leads back to the probe', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/shorts');
  await expect(page.getByRole('heading', { name: 'Short circuit', level: 1 })).toBeVisible();
  const short = page.getByTestId('short');
  await expect(short).toHaveCount(1);
  await expect(short).toContainText('[Revenue YTD] is missing from the model');
  await expect(short).toContainText("The value for 'Revenue YTD' cannot be determined");
  await assertNoHorizontalScroll(page);

  await short.getByRole('button', { name: 'Open probe' }).click();
  await expect(page.getByTestId('case-drawer').getByLabel('Name')).toHaveValue('Revenue YTD (measure was renamed)');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await short.getByRole('button', { name: 'Show on bench' }).click();
  await expect(page.getByTestId('bench-stage')).toHaveAttribute('data-focus', /.+/);
  await expect(page.getByTestId('bench-readout')).toContainText('Revenue YTD (measure was renamed)');
  consoleWatch.assertClean();
});

test('Short circuit is empty once the erroring probe is disabled', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  const toggle = page.getByRole('switch', { name: 'Enabled: Revenue YTD (measure was renamed)' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.goto('/#/shorts');
  await expect(page.getByTestId('shorts-empty')).toBeVisible();
});
