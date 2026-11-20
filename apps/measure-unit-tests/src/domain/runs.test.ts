import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs, type TestRun } from '../model';
import { seed } from '../seed';
import { elapsedMs, filterResults, formatMs, formatRate, getRunDetail, historyPoints, listRuns, passRate, runPhase } from './runs';

const run = (over: Partial<TestRun>): TestRun => ({
  id: 'r',
  suiteId: 's',
  startedAt: FIXED_NOW.toISOString(),
  finishedAt: null,
  startedBy: 'u',
  startedByName: 'U',
  status: 'done',
  caseCount: 0,
  disabledCount: 0,
  passCount: 0,
  failCount: 0,
  errorCount: 0,
  ...over,
});

describe('runs helpers', () => {
  it('passRate over cases with a result', () => {
    expect(passRate({ passCount: 5, failCount: 1, errorCount: 1 })).toBeCloseTo(5 / 7);
    expect(passRate({ passCount: 0, failCount: 0, errorCount: 0 })).toBeNull();
    expect(formatRate(5 / 7)).toBe('71%');
    expect(formatRate(null)).toBe('—');
  });

  it('runPhase marks old running runs as interrupted', () => {
    const r = run({ status: 'running' });
    expect(runPhase(r, new Date(FIXED_NOW.getTime() + 60_000))).toBe('running');
    expect(runPhase(r, new Date(FIXED_NOW.getTime() + 11 * 60_000))).toBe('interrupted');
    expect(runPhase(run({ status: 'cancelled' }))).toBe('cancelled');
  });

  it('elapsed and formatting', () => {
    const r = run({ finishedAt: new Date(FIXED_NOW.getTime() + 4200).toISOString() });
    expect(elapsedMs(r)).toBe(4200);
    expect(formatMs(850)).toBe('850 ms');
    expect(formatMs(4200)).toBe('4.2 s');
    expect(formatMs(65_000)).toBe('1 min 5 s');
  });

  it('historyPoints keeps the last 30, oldest first, as percentages', () => {
    const runs = Array.from({ length: 35 }, (_, i) =>
      run({ id: `r${i}`, startedAt: new Date(FIXED_NOW.getTime() + i * 1000).toISOString(), passCount: i % 2 ? 1 : 3, failCount: 1 }),
    ).reverse();
    const pts = historyPoints(runs);
    expect(pts).toHaveLength(30);
    expect(pts[0]).toMatchObject({ runId: 'r5', label: '#6' });
    expect(pts[29]).toMatchObject({ runId: 'r34', label: '#35', passRate: 75 });
    expect(historyPoints([run({ passCount: 0 })])[0].passRate).toBeNull();
  });

  it('filterResults by status', () => {
    const rs = [{ status: 'pass' as const }, { status: 'fail' as const }, { status: 'pass' as const }];
    expect(filterResults(rs, 'all')).toHaveLength(3);
    expect(filterResults(rs, 'pass')).toHaveLength(2);
    expect(filterResults(rs, 'error')).toHaveLength(0);
  });

  it('seeded history: three runs, newest first, with results', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const suite = (await store.repo('TestSuite').list())[0];
    const runs = await listRuns(store, suite.id);
    expect(runs.map((r) => r.status)).toEqual(['done', 'cancelled', 'done']);
    expect(runs[0]).toMatchObject({ passCount: 5, failCount: 1, errorCount: 1, disabledCount: 1 });
    expect(historyPoints(runs).length).toBeGreaterThanOrEqual(2);
    const d = await getRunDetail(store, runs[1].id);
    expect(d.suite?.name).toBe('Sales sanity');
    expect(d.results).toHaveLength(3);
    await expect(getRunDetail(store, 'missing')).rejects.toThrow(/not found/);
  });
});
