import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('AC1 + AC3: create a suite and add a case in Measure mode, using the tested value as expected', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  await page.getByRole('button', { name: 'New suite' }).first().click();
  await page.getByLabel('Suite name').fill('Finance checks');
  await page.getByRole('button', { name: 'Create suite' }).click();
  await expect(page.getByRole('heading', { name: 'Finance checks' })).toBeVisible();

  await page.getByRole('button', { name: 'Add case' }).first().click();
  const drawer = page.getByTestId('case-drawer');
  await drawer.getByLabel('Name').fill('Sales for 2025');
  await drawer.getByRole('textbox', { name: 'Measure', exact: true }).fill('[Total Sales]');
  await drawer.getByLabel('Filter (optional)').fill("'Date'[Year] = 2025");
  await expect(drawer.getByTestId('built-dax')).toHaveText(`EVALUATE ROW("v", CALCULATE([Total Sales], 'Date'[Year] = 2025))`);
  await drawer.getByRole('button', { name: 'Test query' }).click();
  await expect(drawer.getByTestId('first-cell')).toHaveText('13709');
  await drawer.getByRole('button', { name: 'Use this value as expected' }).click();
  await expect(drawer.getByLabel('Expected')).toHaveValue('13709');
  await page.getByRole('button', { name: 'Add case', exact: true }).last().click();

  const row = page.getByTestId('case-row').filter({ hasText: 'Sales for 2025' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('13709');
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('AC3: "Use this value as expected" fills strings from Raw DAX', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByRole('button', { name: 'Add case' }).first().click();
  const drawer = page.getByTestId('case-drawer');
  await drawer.getByRole('tab', { name: 'Raw DAX' }).click();
  await drawer.getByLabel('DAX query').fill(`EVALUATE TOPN(1, VALUES('Product'[Category]), 'Product'[Category], ASC)`);
  await drawer.getByRole('button', { name: 'Test query' }).click();
  await expect(drawer.getByTestId('first-cell')).toHaveText('Accessories');
  await drawer.getByRole('button', { name: 'Use this value as expected' }).click();
  await expect(drawer.getByLabel('Expected')).toHaveValue('Accessories');
});

test('Raw DAX must begin with EVALUATE or DEFINE', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByRole('button', { name: 'Add case' }).first().click();
  const drawer = page.getByTestId('case-drawer');
  await drawer.getByLabel('Name').fill('Bad query');
  await drawer.getByRole('tab', { name: 'Raw DAX' }).click();
  await drawer.getByLabel('DAX query').fill('SELECT * FROM Sales');
  await drawer.getByLabel('Expected').fill('1');
  await page.getByRole('button', { name: 'Add case', exact: true }).last().click();
  await expect(drawer.getByText('A DAX query must begin with EVALUATE or DEFINE.')).toBeVisible();
  await drawer.getByLabel('DAX query').fill('-- leading comment\nEVALUATE ROW("v", [Units])');
  await drawer.getByRole('button', { name: 'Test query' }).click();
  await expect(drawer.getByTestId('first-cell')).toHaveText('963');
});

test('a non-owner can view and run but not edit cases', async ({ page }) => {
  await openApp(page, '/', 'demo-user');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await expect(page.getByRole('button', { name: 'Run suite' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Add case' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit suite' })).toHaveCount(0);
  await expect(page.getByRole('switch').first()).toBeDisabled();
  await page.getByRole('button', { name: 'Total sales matches the finance close' }).click();
  await expect(page.getByText('Only the suite owner or an admin can edit this case.')).toBeVisible();
  await expect(page.getByTestId('case-drawer').getByLabel('Name')).toBeDisabled();
});
