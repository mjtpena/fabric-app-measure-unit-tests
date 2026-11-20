import type { DataStore } from '@x10/shared/data';
import { addDays, addMinutes } from '@x10/shared/lib';
import type { SeedContext } from '@x10/shared/runtime';

import type { CaseKind, ResultStatus, Schema, TestCase } from './model';

/**
 * Every value the seed cases depend on, in one place, so they can be retuned to the real bound model.
 * `model*` values are what the offline MockModelClient answers; the seed's expected text is derived from the rest.
 * Target model: "X10 Retail Demo Model" (tables Sales, Product, Store, Date; measures [Total Sales], [Order Count],
 * [Total Cost], [Margin %], [Avg Order Value], [Units]).
 */
export const SEED_EXPECTED = {
  /** [Total Sales] over all data. Expected is written with a currency symbol and separators on purpose. */
  totalSales: 34054.7,
  totalSalesTolerance: '0.01',
  /** [Order Count] over all data. Expected is written with a thousands separator style ("320"). */
  orderCount: 320,
  /** [Margin %] must sit inside this band; the model answers modelMarginPct. */
  marginLow: 0.2,
  marginHigh: 0.6,
  modelMarginPct: 0.40312644069687886,
  /** First 'Product'[Category] in ascending order (a blank category would sort first and fail the check). */
  firstCategory: 'Accessories',
  /** Rows in the Store lookup table. */
  storeCount: 6,
  /** Deliberately failing case: [Total Sales] for 2025 is expected at 15000 (±1%) but the model answers 13709. */
  sales2025Expected: 15000,
  sales2025Tolerance: '1%',
  modelSales2025: 13709,
  /** Deliberately erroring case: a measure that does not exist in the model. */
  unknownMeasure: 'Revenue YTD',
  /** Disabled case: [Total Cost] within a sanity band. */
  totalCostLow: 0,
  totalCostHigh: 100_000,
  modelTotalCost: 20326.35,
  /** Other values the mock answers, so new Measure-mode cases work offline. */
  modelAvgOrderValue: 106.4209,
  modelUnits: 963,
  productCount: 12,
  dateCount: 731,
} as const;

/** The seed cases' DAX. The mock model answers these exact queries from SEED_EXPECTED. */
export const SEED_DAX = {
  totalSales: 'EVALUATE ROW("v", [Total Sales])',
  orderCount: 'EVALUATE ROW("v", [Order Count])',
  marginPct: 'EVALUATE ROW("v", [Margin %])',
  firstCategory: `EVALUATE TOPN(1, VALUES('Product'[Category]), 'Product'[Category], ASC)`,
  storeRows: `EVALUATE 'Store'`,
  sales2025: `EVALUATE ROW("v", CALCULATE([Total Sales], 'Date'[Year] = 2025))`,
  unknownMeasure: `EVALUATE ROW("v", [${SEED_EXPECTED.unknownMeasure}])`,
  totalCost: 'EVALUATE ROW("v", [Total Cost])',
} as const;

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thousands = (n: number) => n.toLocaleString('en-US');

export type SeedCaseKey = keyof typeof SEED_DAX;

interface SeedCase {
  key: SeedCaseKey;
  name: string;
  kind: CaseKind;
  expected: string | null;
  tolerance: string | null;
  tags: string;
  enabled: boolean;
}

/** The 8 seed cases. Expected outcome against the mock model: 5 pass, 1 fail, 1 error, 1 disabled. */
export const SEED_CASES: SeedCase[] = [
  {
    key: 'totalSales',
    name: 'Total sales matches the finance close',
    kind: 'scalar',
    expected: money(SEED_EXPECTED.totalSales),
    tolerance: SEED_EXPECTED.totalSalesTolerance,
    tags: 'sales, finance',
    enabled: true,
  },
  {
    key: 'orderCount',
    name: 'Order count matches the order system',
    kind: 'scalar',
    expected: thousands(SEED_EXPECTED.orderCount),
    tolerance: null,
    tags: 'orders',
    enabled: true,
  },
  {
    key: 'marginPct',
    name: 'Margin % stays between 20% and 60%',
    kind: 'between',
    expected: `${SEED_EXPECTED.marginLow}..${SEED_EXPECTED.marginHigh}`,
    tolerance: null,
    tags: 'margin',
    enabled: true,
  },
  {
    key: 'firstCategory',
    name: 'Every product has a category',
    kind: 'notblank',
    expected: null,
    tolerance: null,
    tags: 'product, data quality',
    enabled: true,
  },
  {
    key: 'storeRows',
    name: 'Store lookup has one row per store',
    kind: 'rowcount',
    expected: String(SEED_EXPECTED.storeCount),
    tolerance: null,
    tags: 'store, lookup',
    enabled: true,
  },
  {
    key: 'sales2025',
    name: 'Sales for 2025 reach the 15,000 plan',
    kind: 'scalar',
    expected: thousands(SEED_EXPECTED.sales2025Expected),
    tolerance: SEED_EXPECTED.sales2025Tolerance,
    tags: 'sales, plan',
    enabled: true,
  },
  {
    key: 'unknownMeasure',
    name: 'Revenue YTD (measure was renamed)',
    kind: 'scalar',
    expected: '30000',
    tolerance: '0.5%',
    tags: 'sales',
    enabled: true,
  },
  {
    key: 'totalCost',
    name: 'Total cost is within a sane range',
    kind: 'between',
    expected: `${SEED_EXPECTED.totalCostLow}..${SEED_EXPECTED.totalCostHigh}`,
    tolerance: null,
    tags: 'cost',
    enabled: false,
  },
];

export const SEED_SUITE = {
  name: 'Sales sanity',
  description:
    'Core sales measures checked after every model change. Edit the DAX to match your model if you rebind the connector.',
};

type Outcome = { status: ResultStatus; actual: string | null; message: string };

/** Results of the seeded history runs, per case key. */
const PAST: Record<SeedCaseKey, { pass: Outcome; fail: Outcome; error?: Outcome }> = {
  totalSales: {
    pass: { status: 'pass', actual: String(SEED_EXPECTED.totalSales), message: 'Exact match.' },
    fail: { status: 'fail', actual: '33911.2', message: 'Off by -143.5 (-0.42%); tolerance ±0.01.' },
  },
  orderCount: {
    pass: { status: 'pass', actual: String(SEED_EXPECTED.orderCount), message: 'Exact match.' },
    fail: { status: 'fail', actual: '318', message: 'Off by -2 (-0.63%); tolerance ±0.000001.' },
  },
  marginPct: {
    pass: { status: 'pass', actual: String(SEED_EXPECTED.modelMarginPct), message: 'Within 0.2..0.6.' },
    fail: { status: 'fail', actual: '0.6412', message: '0.6412 is above 0.2..0.6.' },
  },
  firstCategory: {
    pass: { status: 'pass', actual: SEED_EXPECTED.firstCategory, message: 'The first cell has a value.' },
    fail: { status: 'fail', actual: '(blank)', message: 'The first cell is blank.' },
  },
  storeRows: {
    pass: { status: 'pass', actual: String(SEED_EXPECTED.storeCount), message: `${SEED_EXPECTED.storeCount} rows, as expected.` },
    fail: { status: 'fail', actual: '5', message: `Expected ${SEED_EXPECTED.storeCount} rows, got 5.` },
  },
  sales2025: {
    pass: { status: 'pass', actual: '14912', message: 'Within tolerance (±1%).' },
    fail: { status: 'fail', actual: String(SEED_EXPECTED.modelSales2025), message: 'Off by -1291 (-8.61%); tolerance ±1%.' },
  },
  unknownMeasure: {
    pass: { status: 'pass', actual: '30090', message: 'Within tolerance (±0.5%).' },
    fail: { status: 'fail', actual: '28750', message: 'Off by -1250 (-4.17%); tolerance ±0.5%.' },
    error: {
      status: 'error',
      actual: null,
      message: `query: The value for '${SEED_EXPECTED.unknownMeasure}' cannot be determined. Either the measure does not exist, or there is no current row for a column named '${SEED_EXPECTED.unknownMeasure}'.`,
    },
  },
  totalCost: {
    pass: { status: 'pass', actual: String(SEED_EXPECTED.modelTotalCost), message: 'Within 0..100000.' },
    fail: { status: 'fail', actual: '-1', message: '-1 is below 0..100000.' },
  },
};

/**
 * Fictional, generic seed data. Dates are computed from ctx.now. Runs once (runSeed checks a marker row).
 * One suite "Sales sanity" with 8 cases (one per kind, one failing, one erroring, one disabled) and three past runs
 * (done, cancelled, done) so the History chart and last-status columns have data.
 */
export async function seed(store: DataStore<Schema>, ctx: SeedContext): Promise<void> {
  const [owner, analyst] = ctx.people;
  const suite = await store.repo('TestSuite').create({
    name: SEED_SUITE.name,
    description: SEED_SUITE.description,
    createdBy: owner.sub,
    createdByName: owner.displayName,
    createdAt: addDays(ctx.now, -14),
  });

  const cases: (TestCase & { key: SeedCaseKey })[] = [];
  for (const [i, c] of SEED_CASES.entries()) {
    const at = addMinutes(addDays(ctx.now, -14), 5 + i * 3);
    const row = await store.repo('TestCase').create({
      suiteId: suite.id,
      name: c.name,
      kind: c.kind,
      dax: SEED_DAX[c.key],
      expected: c.expected,
      tolerance: c.tolerance,
      tags: c.tags,
      enabled: c.enabled,
      ownerSub: owner.sub,
      createdAt: at,
      updatedAt: c.key === 'unknownMeasure' ? addDays(ctx.now, -3) : at,
    });
    cases.push({ ...row, key: c.key });
  }

  // Past runs: [days ago, who, status, outcome per case key ('-' = not run)].
  type Plan = Partial<Record<SeedCaseKey, 'pass' | 'fail' | 'error'>>;
  const runs: { daysAgo: number; by: typeof owner; status: 'done' | 'cancelled'; plan: Plan }[] = [
    {
      daysAgo: 9,
      by: owner,
      status: 'done',
      plan: { totalSales: 'pass', orderCount: 'fail', marginPct: 'pass', firstCategory: 'fail', storeRows: 'pass', sales2025: 'pass', unknownMeasure: 'fail' },
    },
    { daysAgo: 5, by: analyst, status: 'cancelled', plan: { totalSales: 'pass', orderCount: 'pass', marginPct: 'pass' } },
    {
      daysAgo: 1,
      by: owner,
      status: 'done',
      plan: { totalSales: 'pass', orderCount: 'pass', marginPct: 'pass', firstCategory: 'pass', storeRows: 'pass', sales2025: 'fail', unknownMeasure: 'error' },
    },
  ];
  const enabled = cases.filter((c) => c.enabled);
  for (const r of runs) {
    const startedAt = addMinutes(addDays(ctx.now, -r.daysAgo), -90);
    const planned = enabled.filter((c) => r.plan[c.key]);
    const outcomes = planned.map((c) => {
      const kind = r.plan[c.key]!;
      return { c, o: kind === 'error' ? PAST[c.key].error! : PAST[c.key][kind] };
    });
    const count = (s: ResultStatus) => outcomes.filter((x) => x.o.status === s).length;
    const run = await store.repo('TestRun').create({
      suiteId: suite.id,
      startedAt,
      finishedAt: new Date(new Date(startedAt).getTime() + 1_900 + outcomes.length * 410).toISOString(),
      startedBy: r.by.sub,
      startedByName: r.by.displayName,
      status: r.status,
      caseCount: r.status === 'cancelled' ? enabled.length : planned.length,
      disabledCount: cases.length - enabled.length,
      passCount: count('pass'),
      failCount: count('fail'),
      errorCount: count('error'),
    });
    for (const [i, { c, o }] of outcomes.entries()) {
      await store.repo('TestResult').create({
        runId: run.id,
        suiteId: suite.id,
        caseId: c.id,
        caseName: c.name,
        kind: c.kind,
        status: o.status,
        expected: c.expected,
        actual: o.actual,
        message: o.message,
        durationMs: 180 + ((i * 137) % 420),
        startedBy: r.by.sub,
        createdAt: new Date(new Date(startedAt).getTime() + 400 + i * 380).toISOString(),
      });
    }
  }
}
