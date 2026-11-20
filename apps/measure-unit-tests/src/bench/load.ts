/** Read everything the bench draws, in one round of parallel queries. */
import type { DataStore } from '@x10/shared/data';

import type { Schema } from '../model';
import { buildBench, type BenchData } from './model';

export async function loadBench(store: DataStore<Schema>): Promise<BenchData> {
  const [suites, cases, runs, results] = await Promise.all([
    store.repo('TestSuite').list(),
    store.repo('TestCase').list(),
    store.repo('TestRun').list(),
    store.repo('TestResult').list(),
  ]);
  return buildBench(suites, cases, runs, results);
}

/** One suite's board (board and run pages). */
export async function loadBoard(store: DataStore<Schema>, suiteId: string): Promise<BenchData> {
  const [suite, cases, runs, results] = await Promise.all([
    store.repo('TestSuite').get(suiteId),
    store.repo('TestCase').list({ where: { suiteId } }),
    store.repo('TestRun').list({ where: { suiteId } }),
    store.repo('TestResult').list({ where: { suiteId } }),
  ]);
  return buildBench(suite ? [suite] : [], cases, runs, results);
}
