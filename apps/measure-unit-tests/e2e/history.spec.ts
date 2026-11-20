import { expect, test } from '@playwright/test';

import { assertNoHorizontalScroll, openApp, watchConsole } from '@x10/shared/e2e';

test('AC4: the Oscilloscope shows the runs and clicking a point opens that run', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByRole('main').getByRole('link', { name: 'Oscilloscope' }).click();
  await expect(page.getByRole('heading', { name: 'Oscilloscope' })).toBeVisible();
  await expect(page.getByTestId('run-row')).toHaveCount(3);
  // One channel per probe.
  await expect(page.getByTestId('scope-channel')).toHaveCount(8);

  const dots = page.getByTestId('history-point');
  await expect(dots).toHaveCount(3);
  // The cancelled run (#2, by Sam Taylor) is the middle point.
  await dots.nth(1).click();
  await expect(page.getByRole('heading', { name: 'Run results' })).toBeVisible();
  await expect(page.getByText('by Sam Taylor')).toBeVisible();
  await expect(page.getByTestId('result-row')).toHaveCount(3);
  await assertNoHorizontalScroll(page);
  consoleWatch.assertClean();
});

test('a new run is added to the history', async ({ page }) => {
  await openApp(page, '/');
  await page.getByRole('link', { name: 'Sales sanity' }).click();
  await page.getByRole('button', { name: 'Run suite' }).click();
  await expect(page.getByTestId('run-progress')).toContainText('7 of 7 cases complete', { timeout: 15_000 });
  await page.getByRole('main').getByRole('link', { name: 'Oscilloscope' }).click();
  await expect(page.getByTestId('run-row')).toHaveCount(4);
  await page.getByTestId('run-row').first().getByRole('link').click();
  await expect(page.getByTestId('count-pass')).toContainText('5');
});

test('the Oscilloscope nav item opens a suite; ?case= highlights that probe’s channel', async ({ page }) => {
  await openApp(page, '/scope');
  await expect(page.getByRole('heading', { name: 'Oscilloscope' })).toBeVisible();
  await expect(page.getByTestId('history-point')).toHaveCount(3);
  const channel = page.getByTestId('scope-channel').nth(1);
  const id = await channel.getAttribute('data-case-id');
  const base = page.url().split('?case=')[0];
  await page.goto(`${base}?case=${id}`);
  await expect(page.getByTestId('scope-channel').nth(1)).toHaveAttribute('opacity', '1');
  await expect(page.getByTestId('scope-channel').nth(0)).toHaveAttribute('opacity', '0.45');
});
