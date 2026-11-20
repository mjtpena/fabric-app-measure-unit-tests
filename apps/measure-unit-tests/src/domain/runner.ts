/**
 * Run engine. Runs a suite's enabled cases (or a selection) against the model with a small worker pool:
 * concurrency 2, a 30 s timeout per case, and a cancel signal that stops queued cases (cases already running finish).
 * Write order: the TestRun row first, then one TestResult per case as each completes, then the run's counts.
 * A connector failure becomes a result with status "error"; the engine never throws for a query.
 */
import type { ModelClient, ModelQueryResult } from '@x10/shared/connectors';
import { PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';

import { RUN_RULES } from '../config';
import { limits, type CaseKind, type Schema, type TestCase, type TestResult, type TestRun } from '../model';
import { evaluate, type Verdict } from './compare';

/**
 * Run `worker` over `items` with at most `concurrency` in flight. When `signal` aborts, queued items are not started;
 * items already started run to completion. Resolves with the outputs of the items that ran, in completion order.
 * If a worker throws, no new items start, every lane is awaited (so nothing is still running when this settles), and
 * then the first error is rethrown.
 */
export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: { concurrency: number; signal?: AbortSignal },
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  let failed = false;
  const lanes = Math.max(1, Math.min(opts.concurrency, items.length));
  const lane = async () => {
    while (next < items.length && !opts.signal?.aborted && !failed) {
      const i = next++;
      try {
        out.push(await worker(items[i], i));
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: lanes }, lane));
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (rejected) throw rejected.reason;
  return out;
}

/** Row cap sent with a case's query. Rowcount needs every row; the others read only the first cell. */
export function rowLimitFor(kind: CaseKind): number {
  return kind === 'rowcount' ? RUN_RULES.rowcountRowLimit : RUN_RULES.queryRowLimit;
}

export interface CaseOutcome extends Verdict {
  durationMs: number;
  result: ModelQueryResult;
}

/** Run one case's query and compare. Never throws. */
export async function executeCase(
  client: ModelClient,
  c: Pick<TestCase, 'kind' | 'dax' | 'expected' | 'tolerance'>,
  opts: { timeoutMs?: number; clock?: () => number } = {},
): Promise<CaseOutcome> {
  const clock = opts.clock ?? (() => Date.now());
  const t0 = clock();
  let result: ModelQueryResult;
  try {
    result = await client.executeQuery(c.dax, { rowLimit: rowLimitFor(c.kind), timeoutMs: opts.timeoutMs ?? RUN_RULES.timeoutMs });
  } catch (err) {
    result = { status: 'error', error: { category: 'unknown', message: err instanceof Error ? err.message : String(err) } };
  }
  const durationMs = Math.max(0, Math.round(clock() - t0));
  return { ...evaluate(c.kind, result, c.expected, c.tolerance), durationMs, result };
}

export interface RunOptions {
  /** Run only these case ids (they must be enabled). Omit to run every enabled case of the suite. */
  caseIds?: string[];
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called once the TestRun row exists (before any query runs). */
  onStart?: (run: TestRun, cases: TestCase[]) => void;
  /** Called after each TestResult row is written. */
  onResult?: (result: TestResult) => void;
  now?: () => Date;
}

/** Counts for a run from its results. */
export function tally(results: Pick<TestResult, 'status'>[]) {
  return {
    passCount: results.filter((r) => r.status === 'pass').length,
    failCount: results.filter((r) => r.status === 'fail').length,
    errorCount: results.filter((r) => r.status === 'error').length,
  };
}

/** Run a suite. Anyone signed in may run any suite; runs are separate rows, so concurrent runs are fine. */
export async function runSuite(
  store: DataStore<Schema>,
  me: Person,
  client: ModelClient,
  suiteId: string,
  opts: RunOptions = {},
): Promise<TestRun> {
  const now = opts.now ?? (() => new Date());
  if (!me?.sub) throw new PermissionError('Sign in to run a suite.');
  const suite = await store.repo('TestSuite').get(suiteId);
  if (!suite) throw new RuleError('This suite no longer exists.');
  const all = (await store.repo('TestCase').list({ where: { suiteId } })).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name),
  );
  const enabled = all.filter((c) => c.enabled);
  const selected = opts.caseIds ? enabled.filter((c) => opts.caseIds!.includes(c.id)) : enabled;
  if (!selected.length) {
    throw new RuleError(opts.caseIds ? 'Select at least one enabled case to run.' : 'This suite has no enabled cases to run.');
  }

  // 1. The run row first.
  const run = await store.repo('TestRun').create({
    suiteId,
    startedAt: now().toISOString(),
    finishedAt: null,
    startedBy: me.sub,
    startedByName: me.displayName.slice(0, limits.personName.max),
    status: 'running',
    caseCount: selected.length,
    disabledCount: opts.caseIds ? 0 : all.length - enabled.length,
    passCount: 0,
    failCount: 0,
    errorCount: 0,
  });
  opts.onStart?.(run, selected);

  // 2. One result per case as each completes.
  const written: TestResult[] = [];
  try {
    await runPool(
      selected,
      async (c) => {
        const o = await executeCase(client, c, { timeoutMs: opts.timeoutMs ?? RUN_RULES.timeoutMs });
        const row = await store.repo('TestResult').create({
          runId: run.id,
          suiteId,
          caseId: c.id,
          caseName: c.name,
          kind: c.kind,
          status: o.status,
          expected: c.expected,
          actual: o.actual,
          message: o.message,
          durationMs: o.durationMs,
          startedBy: me.sub,
          createdAt: now().toISOString(),
        });
        written.push(row);
        opts.onResult?.(row);
        return row;
      },
      { concurrency: opts.concurrency ?? RUN_RULES.concurrency, signal: opts.signal },
    );
  } finally {
    // 3. Then the counts, from the rows actually written. runPool only settles once every lane has finished, so no
    // case is still running here, also when a result write failed (the run must not stay "running").
    const cancelled = written.length < selected.length;
    await store.repo('TestRun').update(run.id, {
      ...tally(written),
      status: cancelled ? 'cancelled' : 'done',
      finishedAt: now().toISOString(),
    });
  }
  return (await store.repo('TestRun').get(run.id)) ?? run;
}
