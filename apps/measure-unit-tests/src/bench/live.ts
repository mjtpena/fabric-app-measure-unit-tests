/** The run in progress, as the bench draws it: which probes are queued, which have current flowing, which arrived. */
import { RUN_RULES } from '../config';
import type { TestResult } from '../model';
import type { ActiveRun } from '../run-context';
import { gapFor, type Probe } from './model';

export interface LiveView {
  suiteId: string;
  runId: string;
  /** Case ids in queue order. */
  order: string[];
  arrived: Map<string, TestResult>;
  /** Cases whose query is in flight right now. */
  inflight: Set<string>;
  running: boolean;
}

/**
 * The run pool starts cases in queue order, at most `concurrency` at a time, so the cases in flight are the first
 * ones in the queue that have not reported yet.
 */
export function liveView(active: ActiveRun | null, concurrency: number = RUN_RULES.concurrency): LiveView | null {
  if (!active) return null;
  const arrived = new Map(active.results.map((r) => [r.caseId, r]));
  const running = !active.done;
  const inflight = new Set<string>();
  if (running && !active.cancelling) {
    for (const id of active.caseIds) {
      if (inflight.size >= concurrency) break;
      if (!arrived.has(id)) inflight.add(id);
    }
  }
  return { suiteId: active.run.suiteId, runId: active.run.id, order: active.caseIds, arrived, inflight, running };
}

export type LivePhase = 'queued' | 'flowing' | 'arrived' | null;

/** A probe as it reads during a run: arrived results replace its last reading. */
export function withLive(p: Probe, live: LiveView | null): { probe: Probe; phase: LivePhase } {
  if (!live || live.suiteId !== p.suiteId || !live.order.includes(p.testCase.id)) return { probe: p, phase: null };
  const r = live.arrived.get(p.testCase.id);
  if (r) {
    return {
      probe: { ...p, last: r, gap: r.status === 'fail' ? gapFor(p.testCase.kind, r.expected ?? p.testCase.expected, r.actual) : null },
      phase: 'arrived',
    };
  }
  if (!live.running) return { probe: p, phase: null };
  return { probe: { ...p, last: null, gap: null }, phase: live.inflight.has(p.testCase.id) ? 'flowing' : 'queued' };
}
