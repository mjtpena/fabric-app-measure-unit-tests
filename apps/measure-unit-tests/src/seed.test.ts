import { runSeed } from '@x10/shared/runtime';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from './app.config';
import { evaluate } from './domain/compare';
import { buildMeasureQuery } from './domain/dax';
import { answerMockQuery, createMockModelClient } from './mock-model';
import { defs } from './model';
import { seed, SEED_CASES, SEED_DAX, SEED_EXPECTED } from './seed';

describe('seed', () => {
  it('inserts one suite, 8 cases, 3 runs and their results; a second run is a no-op', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const t = store.dump();
    expect(t.TestSuite).toHaveLength(1);
    expect(t.TestCase).toHaveLength(8);
    expect(t.TestRun).toHaveLength(3);
    expect(t.TestResult).toHaveLength(17);
    const total = t.TestSuite.length + t.TestCase.length + t.TestRun.length + t.TestResult.length;
    expect(total).toBeGreaterThanOrEqual(15);
    expect(total).toBeLessThanOrEqual(40);
    expect(await runSeed(store, personas, seed, FIXED_NOW)).toBe(false);
    expect(store.dump().TestCase).toHaveLength(8);
  });

  it('covers every kind, every result status and every run status; dates come from now', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const t = store.dump();
    expect(new Set(t.TestCase.map((c) => c.kind))).toEqual(new Set(['scalar', 'rowcount', 'notblank', 'between']));
    expect(new Set(t.TestResult.map((r) => r.status))).toEqual(new Set(['pass', 'fail', 'error']));
    expect(new Set(t.TestRun.map((r) => r.status))).toEqual(new Set(['done', 'cancelled']));
    for (const r of t.TestRun) expect(String(r.startedAt) < FIXED_NOW.toISOString()).toBe(true);
  });

  it('against the mock model the seed cases give 5 pass, 1 fail, 1 error, 1 disabled', () => {
    const outcome = SEED_CASES.map((c) => (c.enabled ? evaluate(c.kind, answerMockQuery(SEED_DAX[c.key]), c.expected, c.tolerance).status : 'disabled'));
    const count = (s: string) => outcome.filter((o) => o === s).length;
    expect([count('pass'), count('fail'), count('error'), count('disabled')]).toEqual([5, 1, 1, 1]);
  });
});

describe('mock model', () => {
  it('answers with the real model values', () => {
    expect(answerMockQuery(buildMeasureQuery('[Total Sales]'))).toMatchObject({ table: { rows: [[34054.7]] } });
    expect(answerMockQuery(buildMeasureQuery('[Total Sales]', "'Date'[Year] = 2025"))).toMatchObject({ table: { rows: [[13709]] } });
    expect(answerMockQuery(buildMeasureQuery('[Order Count]'))).toMatchObject({ table: { rows: [[320]] } });
    expect(answerMockQuery(buildMeasureQuery('[Units]'))).toMatchObject({ table: { rows: [[963]] } });
    expect(answerMockQuery(`EVALUATE 'Store'`)).toMatchObject({ status: 'success' });
    const count = (q: string) => {
      const r = answerMockQuery(q);
      return r.status === 'success' ? r.table.rows.length : -1;
    };
    expect(count(`EVALUATE 'Store'`)).toBe(SEED_EXPECTED.storeCount);
    expect(count(`EVALUATE Product`)).toBe(12);
    expect(count(`EVALUATE 'Date'`)).toBe(731);
    expect(answerMockQuery(`EVALUATE ROW("n", COUNTROWS('Date'))`)).toMatchObject({ table: { rows: [[731]] } });
    expect(answerMockQuery(`EVALUATE VALUES('Product'[Category])`)).toMatchObject({ table: { rows: [['Accessories'], ['Bikes'], ['Clothing'], ['Components']] } });
  });

  it('unknown measures and unsupported queries are query errors', () => {
    expect(answerMockQuery(buildMeasureQuery('[Nope]'))).toMatchObject({ status: 'error', error: { category: 'query' } });
    expect(answerMockQuery('EVALUATE SUMMARIZECOLUMNS(1)')).toMatchObject({ status: 'error', error: { category: 'query' } });
  });

  it('the client enforces the row cap as overflow', async () => {
    const r = await createMockModelClient(0).executeQuery(`EVALUATE 'Date'`, { rowLimit: 100 });
    expect(r).toMatchObject({ status: 'error', error: { category: 'overflow' } });
  });
});
