import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs } from '../model';
import { seed, SEED_DAX } from '../seed';
import { bestBenchLayout, findProbe, fitViewBox, layoutBoard } from './layout';
import { liveView, withLive } from './live';
import { legendFor, probePaint, probeReadout } from './lenses';
import { loadBench } from './load';
import { buildBench, caseHistory, chipFor, countFlips, durationRange, durationScale, flakiness, gapFor, probeState, stateCounts, todayEntries } from './model';

describe('chipFor', () => {
  it('groups a case under the measure it evaluates', () => {
    expect(chipFor(SEED_DAX.totalSales)).toEqual({ key: 'm:total sales', label: '[Total Sales]', kind: 'measure' });
    expect(chipFor(SEED_DAX.sales2025).key).toBe('m:total sales');
    expect(chipFor(SEED_DAX.unknownMeasure).label).toBe('[Revenue YTD]');
  });
  it('falls back to the table a query reads', () => {
    expect(chipFor(SEED_DAX.storeRows)).toEqual({ key: 't:store', label: 'Store', kind: 'table' });
    expect(chipFor(SEED_DAX.firstCategory)).toMatchObject({ label: 'Product', kind: 'table' });
    expect(chipFor('EVALUATE Product')).toMatchObject({ label: 'Product', kind: 'table' });
  });
  it('ignores brackets inside strings and comments, and has a generic chip for anything else', () => {
    expect(chipFor('-- [Ignored]\nEVALUATE ROW("[not a measure]", 1)')).toEqual({ key: 'q:query', label: 'Query', kind: 'query' });
  });
});

describe('history and flakiness', () => {
  const runs = [
    { id: 'r3', startedAt: '2026-11-19T00:00:00Z' },
    { id: 'r1', startedAt: '2026-11-11T00:00:00Z' },
    { id: 'r2', startedAt: '2026-11-15T00:00:00Z' },
  ];
  const res = (runId: string, status: 'pass' | 'fail' | 'error') => ({ runId, caseId: 'c', status, createdAt: '' });
  it('orders readings oldest first with gaps for runs the case missed', () => {
    expect(caseHistory('c', runs, [res('r3', 'fail'), res('r1', 'pass')])).toEqual(['pass', null, 'fail']);
  });
  it('counts flips between passing and not passing', () => {
    expect(countFlips(['pass', null, 'fail', 'pass'])).toBe(2);
    expect(countFlips(['fail', 'error', 'fail'])).toBe(0);
    expect(flakiness(['pass'])).toBeNull();
    expect(flakiness(['pass', 'fail', 'pass'])).toBe(1);
    expect(flakiness(['pass', 'pass', 'fail'])).toBe(0.5);
  });
});

describe('gapFor', () => {
  it('reports a scalar gap as a percent of expected', () => {
    expect(gapFor('scalar', '15,000', '13709')).toMatchObject({ text: '−8.6%', versus: '13,709 vs 15,000' });
    expect(gapFor('scalar', '100', '150')).toMatchObject({ text: '+50%' });
  });
  it('reports between, row count and not blank gaps in their own terms', () => {
    expect(gapFor('between', '0.2..0.6', '0.64')?.text).toBe('above by 0.04');
    expect(gapFor('rowcount', '6', '5')?.text).toBe('−1 row');
    expect(gapFor('notblank', null, '(blank)')?.text).toBe('blank');
    expect(gapFor('scalar', 'Accessories', 'Bikes')?.text).toBe('mismatch');
    expect(gapFor('scalar', '1', null)).toBeNull();
  });
});

describe('the seeded bench', () => {
  async function bench() {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    return loadBench(store);
  }

  it('is one board with 7 chips and 8 probes, Total Sales carrying two', async () => {
    const b = await bench();
    expect(b.boards).toHaveLength(1);
    const board = b.boards[0];
    expect(board.chips.map((c) => c.label)).toEqual(['[Total Sales]', '[Order Count]', '[Margin %]', 'Product', 'Store', '[Revenue YTD]', '[Total Cost]']);
    expect(board.chips[0].probes).toHaveLength(2);
    expect(board.runs).toHaveLength(3);
    expect(stateCounts(board.probes)).toEqual({ pass: 5, fail: 1, error: 1, off: 1, idle: 0 });
  });

  it('keeps the latest reading per probe and the gap of the failing one', async () => {
    const b = await bench();
    const fail = b.probes.find((p) => probeState(p) === 'fail')!;
    expect(fail.testCase.name).toBe('Sales for 2025 reach the 15,000 plan');
    expect(fail.gap?.text).toBe('−8.6%');
    expect(fail.history).toEqual(['pass', null, 'fail']);
    expect(probeReadout(fail, 'status')).toBe('13,709 vs 15,000 · −8.6%');
    expect(probePaint(fail, 'status')).toEqual({ color: 'var(--bad-solid)', lit: true });
  });

  it('ranks Today: the failure, the short circuit, a flaky probe, the slowest, the unpowered one', async () => {
    const t = todayEntries(await bench(), FIXED_NOW);
    expect(t.map((x) => x.kind)).toEqual(['fail', 'error', 'flaky', 'slow', 'off']);
    expect(t[0]).toMatchObject({ value: '−8.6%', lens: 'status', severity: 'bad' });
    expect(t[1].title).toBe('[Revenue YTD] is missing from the model');
    expect(t[2].lens).toBe('flakiness');
    // Each item points at a different probe.
    expect(new Set(t.map((x) => x.caseId)).size).toBe(t.length);
  });

  it('flags a board that has never run', () => {
    const suite = { id: 's', name: 'New', description: null, createdBy: 'u', createdByName: 'U', createdAt: '2026-11-01T00:00:00Z' };
    const c = { id: 'c', suiteId: 's', name: 'Case', kind: 'scalar' as const, dax: 'EVALUATE ROW("v", [X])', expected: '1', tolerance: null, tags: null, enabled: true, ownerSub: 'u', createdAt: '', updatedAt: '' };
    const t = todayEntries(buildBench([suite], [c], [], []), FIXED_NOW);
    expect(t).toEqual([expect.objectContaining({ kind: 'stale', title: 'New has never been run' })]);
  });

  it('builds legends with counts and a duration scale relative to the bench', async () => {
    const b = await bench();
    expect(legendFor('status', b.probes).map((l) => [l.label, l.value])).toEqual([
      ['Pass', 5],
      ['Fail', 1],
      ['Error', 1],
      ['Unpowered', 1],
    ]);
    const r = durationRange(b.probes);
    expect(durationScale(r.min, r)).toBe(0);
    expect(durationScale(r.max, r)).toBe(1);
  });
});

describe('layout', () => {
  it('lays chips in a grid with every probe right of its chip and a route from the connector', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const b = await loadBench(store);
    const l = layoutBoard(b.boards[0], 2, { socket: true });
    expect(l.chips).toHaveLength(7);
    expect(l.socket).not.toBeNull();
    expect(l.rails).toHaveLength(4);
    for (const c of l.chips)
      for (const p of c.probes) {
        expect(p.x).toBeGreaterThan(c.x + c.w);
        expect(p.route.startsWith(`M${l.connector.x + l.connector.w}`)).toBe(true);
      }
    const bench = bestBenchLayout(b.boards, 1280, 720, { top: 100, right: 20, bottom: 100, left: 20 }, () => true);
    expect(findProbe(bench, b.probes[0].testCase.id)).not.toBeNull();
    const [, , w, h] = fitViewBox(bench.bounds, 1000, 500, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(w / h).toBeCloseTo(2);
  });
});

describe('live run view', () => {
  it('puts current on the first queued cases that have not reported', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const b = await loadBench(store);
    const ids = b.probes.filter((p) => p.testCase.enabled).map((p) => p.testCase.id);
    const run = { id: 'run', suiteId: b.boards[0].suite.id } as never;
    const first = { ...b.probes[0].last!, caseId: ids[0], status: 'pass' as const };
    const view = liveView({ run, caseIds: ids, total: ids.length, results: [first], cancelling: false, done: false, error: null })!;
    expect([...view.inflight]).toEqual([ids[1], ids[2]]);
    expect(withLive(b.probes[0], view).phase).toBe('arrived');
    expect(withLive(b.probes.find((p) => p.testCase.id === ids[1])!, view).phase).toBe('flowing');
    expect(withLive(b.probes.find((p) => p.testCase.id === ids[4])!, view).phase).toBe('queued');
  });
});
