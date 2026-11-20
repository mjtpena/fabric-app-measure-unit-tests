/** Run results: the board lit with this run's readings (live while it runs), the counts, and every result. */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, Play } from 'lucide-react';

import { describeError, formatDateTime, useAsync, useNow, usePolling } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import { Badge, Breadcrumb, Button, cx, EmptyState, ErrorPanel, InlineError, LinkButton, Skeleton, Stat, StatStrip, TableWrap, Tabs, type Tone } from '@x10/shared/ui';

import { BoardView } from '../bench/BoardView';
import { liveView } from '../bench/live';
import { loadBoard } from '../bench/load';
import { gapFor } from '../bench/model';
import { KIND_INFO } from '../domain/compare';
import { tally } from '../domain/runner';
import { elapsedMs, filterResults, formatMs, formatRate, getRunDetail, passRate, runPhase, type RunPhase, type StatusFilter } from '../domain/runs';
import { explainShort } from '../domain/shorts';
import { RUN_RULES } from '../config';
import type { ResultStatus, Schema, TestResult } from '../model';
import { useModelClient } from '../model-client';
import { useRuns } from '../run-context';

const PHASE: Record<RunPhase, { tone: Tone; label: string }> = {
  running: { tone: 'info', label: 'Running' },
  done: { tone: 'neutral', label: 'Finished' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  interrupted: { tone: 'warn', label: 'Interrupted' },
};
const STATUS: Record<ResultStatus, { tone: Tone; label: string }> = {
  pass: { tone: 'ok', label: 'Pass' },
  fail: { tone: 'bad', label: 'Fail' },
  error: { tone: 'warn', label: 'Error' },
};

export function RunPage() {
  const { runId = '' } = useParams();
  const { store } = useApp<Schema>();
  const client = useModelClient();
  const runs = useRuns();
  const navigate = useNavigate();
  const live = runs.active && runs.active.run.id === runId ? runs.active : null;
  const liveDone = live?.done ?? null;
  const detail = useAsync(async () => {
    const d = await getRunDetail(store, runId);
    const bench = await loadBoard(store, d.run.suiteId);
    return { ...d, board: bench.boards[0] ?? null };
  }, [store, runId, liveDone]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [again, setAgain] = useState<string | null>(null);
  const now = useNow(live && !live.done ? 250 : 30_000);

  // Someone else's run (or one from another tab) that is still running: poll for new results.
  const stored = detail.data?.run;
  const remoteRunning = !live && !!stored && runPhase(stored) === 'running';
  usePolling(detail.reload, RUN_RULES.pollMs, remoteRunning);

  useEffect(() => setFilter('all'), [runId]);

  if (detail.error && !detail.data) return <ErrorPanel error={detail.error} onRetry={() => void detail.reload()} />;
  if (!detail.data) return <RunSkeleton />;

  const d = detail.data;
  const running = !!live && !live.done;
  // Use the live state until the refetch after the run has caught up, so nothing flashes back to zero.
  const useLive = !!live && (running || d.run.status === 'running');
  const run = useLive && live ? live.run : d.run;
  const results: TestResult[] = useLive && live ? live.results : d.results;
  const counts = running ? tally(results) : { passCount: run.passCount, failCount: run.failCount, errorCount: run.errorCount };
  const phase: RunPhase = running ? 'running' : runPhase(run, now);
  const total = run.caseCount;
  const doneCount = results.length;
  const notRun = phase === 'running' ? 0 : Math.max(0, total - doneCount);
  const shown = filterResults(results, filter);
  const elapsed = running ? now.getTime() - new Date(run.startedAt).getTime() : elapsedMs(run, now);
  const rate = passRate(counts);
  const runNumber = d.board ? d.board.runs.length - d.board.runs.findIndex((r) => r.id === run.id) : null;
  const byCase = new Map(results.map((r) => [r.caseId, r]));
  const order = live?.caseIds ?? results.map((r) => r.caseId);

  const runAgain = async () => {
    setAgain(null);
    try {
      navigate(`/runs/${await runs.start(run.suiteId)}`);
    } catch (e) {
      setAgain(describeError(e).message);
    }
  };

  return (
    <>
      <Breadcrumb
        className="mb-2"
        items={[{ label: 'Bench', to: '/' }, ...(d.suite ? [{ label: d.suite.name, to: `/suites/${d.suite.id}` }] : []), { label: runNumber && runNumber > 0 ? `Run ${runNumber}` : 'Run' }]}
      />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[18rem]">
          <h1 className="m-0 text-xl font-semibold md:text-2xl">Run results</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ui text-muted">
            <span data-testid="run-phase">
              <Badge tone={PHASE[phase].tone} pulse={phase === 'running'}>
                {PHASE[phase].label}
              </Badge>
            </span>
            <span>
              Started {formatDateTime(run.startedAt)} by {run.startedByName}
            </span>
            <span>
              elapsed{' '}
              <span className="font-mono num" data-testid="elapsed">
                {formatMs(elapsed)}
              </span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running && (
            <Button variant="danger" onClick={runs.cancel} busy={live?.cancelling} disabled={live?.cancelling}>
              {live?.cancelling ? 'Cancelling' : 'Cancel run'}
            </Button>
          )}
          {!running && d.suite && (
            <Button icon={<Play />} onClick={() => void runAgain()} disabled={runs.busy}>
              Run again
            </Button>
          )}
          {d.suite && (
            <LinkButton to={`/suites/${d.suite.id}/history`} icon={<Activity />}>
              Oscilloscope
            </LinkButton>
          )}
        </div>
      </div>
      {again && <InlineError error={again} className="mb-3" />}

      {d.board && d.board.probes.length > 0 && (
        <BoardView
          board={d.board}
          modelLabel={client.label}
          live={running ? liveView(live) : null}
          only={running ? null : byCase}
          maxHeight={420}
          label={`Board for this run: ${counts.passCount} pass, ${counts.failCount} fail, ${counts.errorCount} error`}
          className="mb-5"
        />
      )}

      <StatStrip columns={5}>
        <div data-testid="count-pass">
          <Stat label="Pass" value={counts.passCount} tone="ok" />
        </div>
        <div data-testid="count-fail">
          <Stat label="Fail" value={counts.failCount} tone={counts.failCount ? 'bad' : undefined} />
        </div>
        <div data-testid="count-error">
          <Stat label="Error" value={counts.errorCount} tone={counts.errorCount ? 'warn' : undefined} />
        </div>
        <div data-testid="count-disabled">
          <Stat label="Disabled" value={run.disabledCount} hint="skipped, not run" />
        </div>
        <div data-testid="pass-rate" className="col-span-2 md:col-span-1">
          <Stat label="Pass rate" value={formatRate(rate)} hint={notRun ? `${notRun} not run (cancelled)` : undefined} />
        </div>
      </StatStrip>

      <div className="mt-4" data-testid="run-progress">
        <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-ui">
          <span aria-live="polite" className="num">
            {doneCount} of {total} cases complete
            {running && live?.cancelling && ' · cancelling: queued cases will not start'}
          </span>
          {running && <span className="text-muted">Running {RUN_RULES.concurrency} at a time</span>}
        </div>
        <div className="flex gap-1" role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}>
          {Array.from({ length: Math.max(total, 1) }, (_, i) => {
            const id = order[i];
            const r = id ? byCase.get(id) : results[i];
            const flowing = running && !r && i < doneCount + RUN_RULES.concurrency;
            return (
              <span
                key={i}
                className={cx(
                  'h-2 min-w-0 flex-1 rounded-full transition-colors duration-200',
                  r?.status === 'pass' && 'bg-ok-solid',
                  r?.status === 'fail' && 'bg-bad-solid',
                  r?.status === 'error' && 'bg-warn-solid',
                  !r && flowing && 'animate-pulse bg-accent-9',
                  !r && !flowing && 'bg-gray-4',
                )}
              />
            );
          })}
        </div>
      </div>
      {live?.error && (
        <div className="mt-3">
          <ErrorPanel error={live.error} title="The run stopped early" />
        </div>
      )}

      <div className="mt-6">
        <Tabs
          label="Filter results by status"
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'all', label: 'All', count: results.length },
            { value: 'pass', label: 'Pass', count: counts.passCount },
            { value: 'fail', label: 'Fail', count: counts.failCount },
            { value: 'error', label: 'Error', count: counts.errorCount },
          ]}
        />
        {shown.length === 0 ? (
          <EmptyState compact title={running ? 'Waiting for the first result' : filter === 'all' ? 'No results in this run' : `No ${filter} results`}>
            {running ? 'Results land here as each query comes back.' : filter === 'all' ? 'The run was cancelled before any case completed.' : 'Choose another filter to see the rest.'}
          </EmptyState>
        ) : (
          <ResultsTable results={shown} />
        )}
      </div>
    </>
  );
}

function RunSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton width={200} height={14} />
      <Skeleton width={220} height={28} className="mt-3" />
      <Skeleton height={340} className="mt-5 rounded-xl" />
      <Skeleton height={84} className="mt-5 rounded-xl" />
      <Skeleton height={220} className="mt-6 rounded-xl" />
    </div>
  );
}

function ResultsTable({ results }: { results: TestResult[] }) {
  return (
    <TableWrap label="Results">
      <table className="x-table" data-testid="results-table">
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Expected
            </th>
            <th scope="col" className="num">
              Actual
            </th>
            <th scope="col">Message</th>
            <th scope="col" className="num">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const gap = r.status === 'fail' ? gapFor(r.kind, r.expected, r.actual) : null;
            const short = r.status === 'error' ? explainShort(r.message) : null;
            return (
              <tr key={r.id} data-testid="result-row" data-status={r.status}>
                <td className="min-w-[200px]">
                  <div className="font-medium">{r.caseName}</div>
                  <div className="mt-0.5 text-xs text-muted">{KIND_INFO[r.kind].label}</div>
                </td>
                <td>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </td>
                <td className="num max-w-[160px] break-words">{r.kind === 'notblank' ? <span className="text-muted">a value</span> : (r.expected ?? '—')}</td>
                <td className={cx('num max-w-[160px] break-words', r.status === 'fail' && 'font-medium text-bad-text')}>
                  {r.actual ?? <span className="text-muted">—</span>}
                  {gap && <div className="text-xs font-normal">{gap.text}</div>}
                </td>
                <td className="min-w-[220px] max-w-[420px] break-words text-ui">
                  {short && <div className="font-medium text-warn-text">{short.title}</div>}
                  <span className={short ? 'text-muted' : undefined}>{r.message}</span>
                </td>
                <td className="num text-muted">{formatMs(r.durationMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
