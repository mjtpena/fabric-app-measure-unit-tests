/** Runs and results: reading history, pass rates and the chart series. */
import { latestBy, type DataStore } from '@x10/shared/data';

import { RUN_RULES } from '../config';
import type { ResultStatus, Schema, TestResult, TestRun, TestSuite } from '../model';

/** Pass rate of a run (0..1) over the cases that produced a result; null when none did. */
export function passRate(run: Pick<TestRun, 'passCount' | 'failCount' | 'errorCount'>): number | null {
  const total = run.passCount + run.failCount + run.errorCount;
  return total ? run.passCount / total : null;
}

export function latestRun<T extends Pick<TestRun, 'startedAt'>>(runs: T[]): T | null {
  return runs.reduce<T | null>((best, r) => (!best || r.startedAt > best.startedAt ? r : best), null);
}

export type RunPhase = 'running' | 'done' | 'cancelled' | 'interrupted';

/** A run left "running" for longer than the stale limit was interrupted (for example the tab closed mid-run). */
export function runPhase(run: Pick<TestRun, 'status' | 'startedAt'>, now: Date = new Date()): RunPhase {
  if (run.status !== 'running') return run.status;
  return now.getTime() - new Date(run.startedAt).getTime() > RUN_RULES.staleRunMs ? 'interrupted' : 'running';
}

export function elapsedMs(run: Pick<TestRun, 'startedAt' | 'finishedAt'>, now: Date = new Date()): number {
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now.getTime();
  return Math.max(0, end - new Date(run.startedAt).getTime());
}

/** "850 ms", "4.2 s", "1 min 5 s". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export type HistoryPoint = {
  runId: string;
  label: string;
  startedAt: string;
  /** Percent 0..100, or null when the run produced no results. */
  passRate: number | null;
  pass: number;
  fail: number;
  error: number;
};

/** Chart series: the last `max` runs, oldest first, labelled #1..#n in run order. */
export function historyPoints(runs: TestRun[], max: number = RUN_RULES.historyRuns): HistoryPoint[] {
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const offset = Math.max(0, sorted.length - max);
  return sorted.slice(offset).map((r, i) => {
    const rate = passRate(r);
    return {
      runId: r.id,
      label: `#${offset + i + 1}`,
      startedAt: r.startedAt,
      passRate: rate === null ? null : Math.round(rate * 1000) / 10,
      pass: r.passCount,
      fail: r.failCount,
      error: r.errorCount,
    };
  });
}

export type StatusFilter = 'all' | ResultStatus;

export function filterResults<T extends Pick<TestResult, 'status'>>(results: T[], status: StatusFilter): T[] {
  return status === 'all' ? results : results.filter((r) => r.status === status);
}

/** Latest result per case id. */
export function lastResultByCase(results: TestResult[]): Map<string, TestResult> {
  return new Map(latestBy(results, (r) => r.caseId, (r) => r.createdAt).map((r) => [r.caseId, r]));
}

/** Runs of a suite, newest first. */
export async function listRuns(store: DataStore<Schema>, suiteId: string): Promise<TestRun[]> {
  const runs = await store.repo('TestRun').list({ where: { suiteId } });
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface RunDetail {
  run: TestRun;
  suite: TestSuite | null;
  results: TestResult[];
}

export async function getRunDetail(store: DataStore<Schema>, runId: string): Promise<RunDetail> {
  const run = await store.repo('TestRun').get(runId);
  if (!run) throw Object.assign(new Error('This run was not found.'), { category: 'not_found' });
  const [suite, results] = await Promise.all([
    store.repo('TestSuite').get(run.suiteId),
    store.repo('TestResult').list({ where: { runId } }),
  ]);
  results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { run, suite, results };
}
