/**
 * Holds the run this tab is executing, above the routes, so the run keeps going while the user moves between pages
 * and the Run results page can show live progress. One run per tab at a time.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { describeError, type AppErrorInfo } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';

import { runSuite } from './domain/runner';
import type { Schema, TestResult, TestRun } from './model';
import { useModelClient } from './model-client';

export interface ActiveRun {
  run: TestRun;
  /** Queued case ids, in the order the pool starts them. */
  caseIds: string[];
  total: number;
  results: TestResult[];
  cancelling: boolean;
  done: boolean;
  error: AppErrorInfo | null;
}

interface RunCtx {
  active: ActiveRun | null;
  /** Starts a run and resolves with its id once the TestRun row exists. Rejects if the run could not start. */
  start(suiteId: string, caseIds?: string[]): Promise<string>;
  cancel(): void;
  /** Forget a finished run (closes the bench's run monitor). */
  dismiss(): void;
  busy: boolean;
}

const Ctx = createContext<RunCtx | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const { store, me } = useApp<Schema>();
  const client = useModelClient();
  const [active, setActive] = useState<ActiveRun | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const start = useCallback(
    (suiteId: string, caseIds?: string[]) =>
      new Promise<string>((resolve, reject) => {
        const abort = new AbortController();
        ctrl.current = abort;
        let started = false;
        const forRun = (id: string, fn: (a: ActiveRun) => ActiveRun) => setActive((a) => (a && a.run.id === id ? fn(a) : a));
        runSuite(store, me, client, suiteId, {
          caseIds,
          signal: abort.signal,
          onStart: (run, cases) => {
            started = true;
            setActive({ run, caseIds: cases.map((c) => c.id), total: cases.length, results: [], cancelling: false, done: false, error: null });
            resolve(run.id);
          },
          onResult: (r) => forRun(r.runId, (a) => ({ ...a, results: [...a.results, r] })),
        })
          .then((final) => forRun(final.id, (a) => ({ ...a, run: final, done: true })))
          .catch((err) => {
            if (!started) reject(err);
            else setActive((a) => (a ? { ...a, done: true, error: describeError(err) } : a));
          })
          .finally(() => {
            if (ctrl.current === abort) ctrl.current = null;
          });
      }),
    [store, me, client],
  );

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setActive((a) => (a && !a.done ? { ...a, cancelling: true } : a));
  }, []);

  const dismiss = useCallback(() => setActive((a) => (a && a.done ? null : a)), []);

  const value = useMemo<RunCtx>(
    () => ({ active, start, cancel, dismiss, busy: !!active && !active.done }),
    [active, start, cancel, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRuns(): RunCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRuns must be used inside <RunProvider>.');
  return c;
}
