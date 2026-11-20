import { MockModelClient, scalarResult, type ModelClient, type ModelQueryOptions } from '@x10/shared/connectors';
import type { DataStore } from '@x10/shared/data';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { RUN_RULES } from '../config';
import { createMockModelClient } from '../mock-model';
import { defs, type Schema } from '../model';
import { seed } from '../seed';
import { executeCase, rowLimitFor, runPool, runSuite } from './runner';

async function seeded() {
  const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await store.repo('Person').list();
  const owner = people.find((p) => p.sub === 'demo-admin')!;
  const user = people.find((p) => p.sub === 'demo-user')!;
  const suite = (await store.repo('TestSuite').list())[0];
  return { store, owner, user, suite };
}

/** Records every write in order. */
function spyStore(store: DataStore<Schema>, log: string[]): DataStore<Schema> {
  return {
    kind: store.kind,
    repo(name) {
      const r = store.repo(name);
      return {
        ...r,
        create: async (d) => {
          log.push(`create ${name}`);
          return r.create(d);
        },
        update: async (id, p) => {
          log.push(`update ${name}`);
          return r.update(id, p);
        },
      };
    },
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('runPool', () => {
  it('never has more than `concurrency` items in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await runPool([1, 2, 3, 4, 5, 6, 7], async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(5 + (n % 3));
      inFlight--;
      return n * 10;
    }, { concurrency: 2 });
    expect(peak).toBe(2);
    expect(out.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('cancel stops queued items; started ones finish', async () => {
    const ctrl = new AbortController();
    const started: number[] = [];
    const out = await runPool([1, 2, 3, 4, 5], async (n) => {
      started.push(n);
      if (n === 1) {
        await tick(1);
        ctrl.abort();
      }
      await tick(5);
      return n;
    }, { concurrency: 2, signal: ctrl.signal });
    expect(started).toEqual([1, 2]);
    expect(out.sort()).toEqual([1, 2]);
  });

  it('when a worker throws, it waits for the other lane, starts nothing new, then rethrows', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    let settledWhileRunning = false;
    const p = runPool([1, 2, 3, 4], async (n) => {
      started.push(n);
      if (n === 1) {
        await tick(1);
        throw new Error('write failed');
      }
      await tick(30);
      finished.push(n);
      return n;
    }, { concurrency: 2 });
    p.catch(() => {
      settledWhileRunning = finished.length === 0;
    });
    await expect(p).rejects.toThrow('write failed');
    expect(settledWhileRunning).toBe(false);
    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([2]);
  });
});

describe('executeCase', () => {
  it('passes the 30 s timeout and the row cap to the client', async () => {
    const seen: ModelQueryOptions[] = [];
    const client: ModelClient = {
      label: 'spy',
      executeQuery: async (_q, o) => {
        seen.push(o!);
        return scalarResult(1);
      },
    };
    await executeCase(client, { kind: 'scalar', dax: 'EVALUATE ROW("v", 1)', expected: '1', tolerance: null });
    await executeCase(client, { kind: 'rowcount', dax: 'EVALUATE T', expected: '1', tolerance: null });
    expect(seen[0]).toEqual({ rowLimit: RUN_RULES.queryRowLimit, timeoutMs: 30_000 });
    expect(seen[1].rowLimit).toBe(rowLimitFor('rowcount'));
  });

  it('a query that never answers becomes a timeout error', async () => {
    const hang = new MockModelClient(() => new Promise(() => {}));
    const o = await executeCase(hang, { kind: 'scalar', dax: 'EVALUATE ROW("v", 1)', expected: '1', tolerance: null }, { timeoutMs: 20 });
    expect(o.status).toBe('error');
    expect(o.message).toMatch(/^timeout:/);
  });

  it('a client that throws becomes an error result, not an exception', async () => {
    const boom: ModelClient = { label: 'boom', executeQuery: async () => { throw new Error('socket closed'); } };
    const o = await executeCase(boom, { kind: 'scalar', dax: 'EVALUATE ROW("v", 1)', expected: '1', tolerance: null });
    expect(o).toMatchObject({ status: 'error', message: 'unknown: socket closed' });
  });
});

describe('runSuite', () => {
  it('seed outcome: 5 pass, 1 fail, 1 error, 1 disabled', async () => {
    const { store, user, suite } = await seeded();
    const run = await runSuite(store, user, createMockModelClient(0), suite.id);
    expect(run).toMatchObject({ status: 'done', caseCount: 7, disabledCount: 1, passCount: 5, failCount: 1, errorCount: 1, startedBy: 'demo-user' });
    expect(run.finishedAt).toBeTruthy();
    const results = await store.repo('TestResult').list({ where: { runId: run.id } });
    expect(results).toHaveLength(7);
    const error = results.find((r) => r.status === 'error')!;
    expect(error.message).toMatch(/^query: The value for 'Revenue YTD' cannot be determined/);
    const fail = results.find((r) => r.status === 'fail')!;
    expect(fail).toMatchObject({ caseName: 'Sales for 2025 reach the 15,000 plan', actual: '13709', expected: '15,000' });
  });

  it('writes the TestRun first, one TestResult per case as it completes, then the counts', async () => {
    const { store, owner, suite } = await seeded();
    const log: string[] = [];
    const progress: string[] = [];
    await runSuite(spyStore(store, log), owner, createMockModelClient(2), suite.id, {
      onStart: () => progress.push('start'),
      onResult: (r) => progress.push(r.status),
    });
    expect(log[0]).toBe('create TestRun');
    expect(log.slice(1, 8)).toEqual(Array(7).fill('create TestResult'));
    expect(log[8]).toBe('update TestRun');
    expect(log).toHaveLength(9);
    expect(progress[0]).toBe('start');
    expect(progress).toHaveLength(8);
  });

  it('runs at most 2 cases at a time', async () => {
    const { store, owner, suite } = await seeded();
    let inFlight = 0;
    let peak = 0;
    const client: ModelClient = {
      label: 'counting',
      executeQuery: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick(5);
        inFlight--;
        return scalarResult(1);
      },
    };
    await runSuite(store, owner, client, suite.id);
    expect(peak).toBe(2);
  });

  it('cancel stops queued cases and marks the run cancelled', async () => {
    const { store, owner, suite } = await seeded();
    const ctrl = new AbortController();
    const run = await runSuite(store, owner, createMockModelClient(5), suite.id, {
      signal: ctrl.signal,
      onResult: () => ctrl.abort(),
    });
    const results = await store.repo('TestResult').list({ where: { runId: run.id } });
    expect(run.status).toBe('cancelled');
    // The first result triggers cancel; the other case already in flight finishes; nothing else starts.
    expect(results).toHaveLength(2);
    expect(run.passCount + run.failCount + run.errorCount).toBe(2);
    expect(run.caseCount).toBe(7);
  });

  it('Run selected runs only the chosen enabled cases', async () => {
    const { store, owner, suite } = await seeded();
    const cases = await store.repo('TestCase').list({ where: { suiteId: suite.id } });
    const disabled = cases.find((c) => !c.enabled)!;
    const chosen = cases.filter((c) => c.enabled).slice(0, 2);
    const run = await runSuite(store, owner, createMockModelClient(0), suite.id, { caseIds: [...chosen.map((c) => c.id), disabled.id] });
    expect(run.caseCount).toBe(2);
    expect(run.disabledCount).toBe(0);
    await expect(runSuite(store, owner, createMockModelClient(0), suite.id, { caseIds: [disabled.id] })).rejects.toThrow(/enabled/);
  });

  it('two runs of the same suite at once are separate rows', async () => {
    const { store, owner, user, suite } = await seeded();
    const before = (await store.repo('TestRun').list()).length;
    const [a, b] = await Promise.all([
      runSuite(store, owner, createMockModelClient(2), suite.id),
      runSuite(store, user, createMockModelClient(2), suite.id),
    ]);
    expect(a.id).not.toBe(b.id);
    expect((await store.repo('TestRun').list()).length).toBe(before + 2);
    expect(a.passCount).toBe(5);
    expect(b.passCount).toBe(5);
  });

  it('a connector failure on every case still finishes the run with errors', async () => {
    const { store, owner, suite } = await seeded();
    const down: ModelClient = { label: 'down', executeQuery: async () => ({ status: 'error', error: { category: 'network', message: 'offline' } }) };
    const run = await runSuite(store, owner, down, suite.id);
    expect(run).toMatchObject({ status: 'done', errorCount: 7, passCount: 0 });
  });

  it('a failed result write finalises the run only after the other lane finishes, counting what was written', async () => {
    const { store, owner, suite } = await seeded();
    const log: string[] = [];
    let resultWrites = 0;
    const flaky: DataStore<Schema> = {
      kind: store.kind,
      repo(name) {
        const r = store.repo(name);
        return {
          ...r,
          create: async (d) => {
            if (name === 'TestResult' && ++resultWrites === 2) {
              log.push('throw TestResult');
              throw new Error('database unavailable');
            }
            const row = await r.create(d);
            log.push(`create ${name}`);
            return row;
          },
          update: async (id, p) => {
            log.push(`update ${name}`);
            return r.update(id, p);
          },
        };
      },
    };
    // Uneven latency so the other lane is still mid-query when the write fails.
    let n = 0;
    const client: ModelClient = {
      label: 'uneven',
      executeQuery: async (q) => {
        await tick(n++ % 2 ? 40 : 2);
        return createMockModelClient(0).executeQuery(q);
      },
    };
    await expect(runSuite(flaky, owner, client, suite.id)).rejects.toThrow('database unavailable');
    expect(log.at(-1)).toBe('update TestRun');
    expect(log.filter((l) => l === 'update TestRun')).toHaveLength(1);
    const run = (await store.repo('TestRun').list({ orderBy: { field: 'startedAt', dir: 'desc' } }))[0];
    const results = await store.repo('TestResult').list({ where: { runId: run.id } });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThan(7);
    expect(run.status).toBe('cancelled');
    expect(run.passCount + run.failCount + run.errorCount).toBe(results.length);
  });
});
