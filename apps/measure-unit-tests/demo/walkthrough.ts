import type { DemoScript } from '@x10/shared/demo';

/**
 * Narrated walkthrough of Measure Unit Tests in demo mode (offline sample model, seed data).
 * Story: the test bench (a suite as a circuit board), a live run streaming into the probes, Today flying to the
 * failure, lenses, Short circuit explaining the renamed measure, the Probe adding a case with a live reading, the
 * Oscilloscope, and the developer view.
 */
export const script: DemoScript = {
  title: 'Measure Unit Tests: regression tests for DAX',
  persona: 'demo-admin',
  scenes: [
    {
      id: 'hook',
      say: [
        'This is a test suite for a semantic model, drawn as a circuit board.',
        'Each chip is a measure, and each probe soldered to it is a test case with the value we expect.',
      ],
      async run(h) {
        await h.goto('/');
        await h.pause(1200);
        await h.spotlight(h.page.getByTestId('board').first(), 3000);
        await h.pause(1500);
      },
    },
    {
      id: 'status',
      say: [
        'Green probes pass, red fails with the gap shown, and amber means the query itself broke.',
        'The dark one is a disabled case, so it gets no power.',
      ],
      async run(h) {
        await h.hover(h.page.locator('[data-testid="probe"][data-state="fail"]'));
        await h.pause(1800);
        await h.hover(h.page.locator('[data-testid="probe"][data-state="error"]'));
        await h.pause(1500);
        await h.spotlight(h.page.locator('[data-testid="probe"][data-state="off"]'), 2000);
      },
    },
    {
      id: 'live-run',
      say: [
        'I run the suite. Current flows from the model connector to each query in flight, two at a time.',
        'Probes light up as the results stream back, and the monitor counts them as they land.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: 'Run suite' }));
        await h.pause(2500);
        await h.spotlight(h.page.getByTestId('run-monitor'), 2500);
        await h.pause(2500);
      },
    },
    {
      id: 'today',
      say: [
        'Today ranks what needs attention after the run.',
        'The first item flies to the failing probe: sales for 2025 came back at 13,709 against a plan of 15,000.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: /is failing/ }).first());
        await h.pause(1500);
        await h.spotlight(h.page.getByTestId('bench-readout'), 3500);
        await h.pause(1000);
      },
    },
    {
      id: 'lenses',
      say: [
        'Lenses repaint the same board.',
        'Duration shows the slowest queries, and flakiness shows which probes keep flipping between pass and fail.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: 'Close readout' }));
        await h.page.keyboard.press('f');
        await h.pause(800);
        await h.click(h.page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Duration/ }));
        await h.pause(2800);
        await h.click(h.page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Flakiness/ }));
        await h.pause(2800);
        await h.click(h.page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Status/ }));
      },
    },
    {
      id: 'short-circuit',
      say: [
        'Short circuit explains every error in plain words.',
        'Here a measure was renamed, so the model cannot find Revenue YTD, and the fix sits right under it.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('link', { name: 'Short circuit' }).first());
        await h.pause(900);
        await h.spotlight(h.page.getByTestId('short').first(), 4000);
        await h.pause(1200);
      },
    },
    {
      id: 'probe',
      say: [
        'The probe adds a case. I give it a measure and a filter, and it takes a live reading as I type.',
        'One click copies the reading into the expected value, and the new probe is soldered onto the board.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('link', { name: 'Bench' }).first());
        await h.pause(800);
        await h.click(h.page.getByTestId('board-socket'));
        const drawer = h.page.getByTestId('case-drawer');
        await h.type(drawer.getByLabel('Name'), 'Units sold in 2025');
        await h.type(drawer.getByRole('textbox', { name: 'Measure', exact: true }), '[Units]');
        await h.type(drawer.getByLabel('Filter (optional)'), "'Date'[Year] = 2025");
        await h.pause(1400);
        await h.spotlight(drawer.getByTestId('test-query-result'), 1800);
        await h.click(drawer.getByRole('button', { name: 'Use this value as expected' }));
        await h.pause(700);
        await h.click(h.page.getByRole('button', { name: 'Add case', exact: true }).last());
        await h.pause(2500);
      },
    },
    {
      id: 'oscilloscope',
      say: ['The oscilloscope traces every probe across runs, so a flaky test shows up as a busy wave.'],
      async run(h) {
        await h.click(h.page.getByRole('link', { name: 'Oscilloscope' }).first());
        await h.pause(900);
        await h.spotlight(h.page.getByTestId('history-chart'), 3500);
        await h.pause(1000);
      },
    },
    {
      id: 'view-as',
      say: ['View as developer shows what a teammate sees: they can run any suite, but every edit control is gone.'],
      async run(h) {
        await h.goto('/');
        await h.pause(800);
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: /Developer/ }));
        await h.pause(3000);
      },
    },
    {
      id: 'takeaway',
      say: ['Save the numbers that matter, run them after every model change, and see what broke before your users do.'],
      async run(h) {
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: /Owner/ }));
        await h.pause(3500);
      },
    },
  ],
};
