import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('AC2: Run suite shows live progress and ends with 5 pass, 1 fail, 1 error, 1 disabled', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByRole('button', { name: 'Run suite' }).click();

  await expect(page.getByRole('heading', { name: 'Run results' })).toBeVisible();
  // Live: the run is in progress before it finishes.
  await expect(page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  await expect(page.getByTestId('run-progress')).toContainText('of 7 cases complete');

  await expect(page.getByTestId('run-progress')).toContainText('7 of 7 cases complete', { timeout: 15_000 });
  await expect(page.getByTestId('count-pass')).toContainText('5');
  await expect(page.getByTestId('count-fail')).toContainText('1');
  await expect(page.getByTestId('count-error')).toContainText('1');
  await expect(page.getByTestId('count-disabled')).toContainText('1');
  await expect(page.getByTestId('run-phase')).toHaveText(/Finished/);
  await expect(page.getByTestId('result-row')).toHaveCount(7);

  // Filter by status.
  await page.getByRole('tab', { name: /^Fail/ }).click();
  await expect(page.getByTestId('result-row')).toHaveCount(1);
  await expect(page.getByTestId('result-row')).toContainText('Sales for 2025 reach the 15,000 plan');
  await expect(page.getByTestId('result-row')).toContainText('13709');
  await page.getByRole('tab', { name: /^Error/ }).click();
  await expect(page.getByTestId('result-row')).toContainText("The value for 'Revenue YTD' cannot be determined");
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('Cancel stops the queued cases', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByRole('button', { name: 'Run suite' }).click();
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.getByTestId('run-phase')).toHaveText(/Cancelled/, { timeout: 10_000 });
  await expect(page.getByTestId('result-row').first()).toBeVisible();
  const done = await page.getByTestId('result-row').count();
  expect(done).toBeLessThan(7);
});

test('Run selected runs only the chosen cases', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByLabel('Select Total sales matches the finance close').check();
  await page.getByLabel('Select Store lookup has one row per store').check();
  await page.getByRole('button', { name: 'Run selected (2)' }).click();
  await expect(page.getByTestId('run-progress')).toContainText('2 of 2 cases complete', { timeout: 10_000 });
  await expect(page.getByTestId('count-pass')).toContainText('2');
});

test('the owner disables a case and it is skipped', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  const toggle = page.getByRole('switch', { name: 'Enabled: Revenue YTD (measure was renamed)' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Run suite' }).click();
  await expect(page.getByTestId('run-progress')).toContainText('6 of 6 cases complete', { timeout: 15_000 });
  await expect(page.getByTestId('count-error')).toContainText('0');
  await expect(page.getByTestId('count-disabled')).toContainText('2');
});
