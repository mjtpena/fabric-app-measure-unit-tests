import { expect, test, type Page } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

const isPhone = () => test.info().project.name === 'phone';

/** Today lives in the side panel on desktop and in a bottom sheet on phones. */
async function todayItem(page: Page, text: string | RegExp) {
  if (isPhone()) await page.getByRole('button', { name: /^Today/ }).click();
  return page.getByRole('button', { name: text }).first();
}

test('the bench draws the suite as a board: 8 probes, lit by status', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  const stage = page.getByTestId('bench-stage');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-renderer', 'svg');
  await expect(page.getByTestId('board')).toHaveCount(1);
  await expect(page.getByTestId('probe')).toHaveCount(8);
  await expect(page.locator('[data-testid="probe"][data-state="pass"]')).toHaveCount(5);
  await expect(page.locator('[data-testid="probe"][data-state="fail"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="probe"][data-state="error"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="probe"][data-state="off"]')).toHaveCount(1);
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('lenses re-paint the bench (keys 1–4 and the lens bar)', async ({ page }) => {
  await openApp(page, '/');
  const stage = page.getByTestId('bench-stage');
  await expect(stage).toHaveAttribute('data-lens', 'status');
  await page.keyboard.press('2');
  await expect(stage).toHaveAttribute('data-lens', 'duration');
  await expect(page.getByTestId('probe').first()).toContainText('ms last run');
  await page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Flakiness/ }).click();
  await expect(stage).toHaveAttribute('data-lens', 'flakiness');
  await page.keyboard.press('4');
  await expect(stage).toHaveAttribute('data-lens', 'kind');
  await expect(page.getByTestId('probe').first()).toContainText('Scalar');
});

test('a Today item flies to its probe and opens its readout', async ({ page }) => {
  await openApp(page, '/');
  await (await todayItem(page, /Sales for 2025 reach the 15,000 plan is failing/)).click();
  const readout = page.getByTestId('bench-readout');
  await expect(readout).toBeVisible();
  await expect(readout).toContainText('Sales for 2025 reach the 15,000 plan');
  await expect(readout).toContainText('−8.6%');
  const focused = page.locator('[data-testid="probe"][data-focused="true"]');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute('data-state', 'fail');
  await expect(page.getByTestId('bench-stage')).toHaveAttribute('data-focus', (await focused.getAttribute('data-case-id'))!);
  // The readout opens the Probe.
  await readout.getByRole('button', { name: 'Open probe' }).click();
  await expect(page.getByTestId('case-drawer').getByLabel('Name')).toHaveValue('Sales for 2025 reach the 15,000 plan');
});

test('the list view shows the same probes', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('radio', { name: 'List' }).click();
  const list = page.getByTestId('bench-list');
  await expect(list).toBeVisible();
  await expect(list.getByTestId('bench-row')).toHaveCount(8);
  await expect(list.locator('[data-testid="bench-row"][data-state="fail"]')).toContainText('−8.6%');
  await expect(list.locator('[data-testid="bench-row"][data-state="error"]')).toContainText('Revenue YTD');
  await assertNoHorizontalScroll(page);
  await page.getByRole('radio', { name: 'Bench' }).click();
  await expect(page.getByTestId('bench-stage')).toBeVisible();
});

test('?nowebgl: the bench is SVG and needs no WebGL', async ({ page }) => {
  await page.goto('/?nowebgl#/');
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('bench-stage')).toHaveAttribute('data-renderer', 'svg');
  await expect(page.getByTestId('probe')).toHaveCount(8);
});

test('Run on the bench streams results into the probes', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  await page.getByRole('button', { name: 'Run suite' }).click();
  const monitor = page.getByTestId('run-monitor');
  await expect(monitor).toBeVisible();
  await expect(monitor).toContainText('Live run');
  // Current flows to the queries in flight.
  await expect(page.getByTestId('current').first()).toBeAttached();
  await expect(page.getByTestId('monitor-progress')).toHaveText('7 of 7', { timeout: 15_000 });
  await expect(monitor).toContainText('Run finished');
  await expect(page.getByTestId('board-summary')).toHaveText(/5\/7 PASS/);
  await expect(page.locator('[data-testid="probe"][data-state="fail"]')).toHaveCount(1);
  await monitor.getByRole('link', { name: 'Open run results' }).click();
  await expect(page.getByTestId('count-pass')).toContainText('5');
  consoleWatch.assertClean();
});

test('view as developer hides every edit control on the bench', async ({ page }) => {
  await openApp(page, '/');
  await expect(page.getByTestId('board-socket')).toHaveCount(1);
  await page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: /Developer/ }).click();
  await expect(page.getByTestId('board-socket')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add case' })).toHaveCount(0);
  await expect(page.getByTestId('board')).toContainText('RUN ONLY');
});

test('the socket adds a probe that lands on the board, with a live reading', async ({ page }) => {
  await openApp(page, '/');
  await page.getByTestId('board-socket').click();
  const drawer = page.getByTestId('case-drawer');
  await drawer.getByLabel('Name').fill('Units sold in 2025');
  await drawer.getByRole('textbox', { name: 'Measure', exact: true }).fill('[Units]');
  await drawer.getByLabel('Filter (optional)').fill("'Date'[Year] = 2025");
  // Live reading: no click needed.
  await expect(drawer.getByTestId('first-cell')).toBeVisible();
  await drawer.getByRole('button', { name: 'Use this value as expected' }).click();
  await page.getByRole('button', { name: 'Add case', exact: true }).last().click();
  await expect(page.getByTestId('probe')).toHaveCount(9);
  await expect(page.getByTestId('bench-readout')).toContainText('Units sold in 2025');
});
