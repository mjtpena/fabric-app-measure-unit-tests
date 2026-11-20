import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('loads, creates a record, sees it listed, no console errors', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  await expect(page.getByTestId('bench-stage')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sales sanity' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sales sanity' })).toBeVisible();
  await page.getByRole('button', { name: 'New suite' }).first().click();
  await page.getByLabel('Suite name').fill('Smoke test suite');
  await page.getByRole('button', { name: 'Create suite' }).click();
  await expect(page.getByRole('heading', { name: 'Smoke test suite' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Bench', exact: true }).click();
  // Two boards now: the bench shows both, each title a link to its board page.
  await expect(page.getByRole('heading', { name: 'Test bench' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Smoke test suite' })).toBeVisible();
  await expect(page.getByTestId('board')).toHaveCount(2);
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});
