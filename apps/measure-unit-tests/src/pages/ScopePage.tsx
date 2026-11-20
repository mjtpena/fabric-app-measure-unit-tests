/**
 * The Oscilloscope: a suite's run history on a scope screen. Channel A traces the pass rate per run; below it every
 * probe has its own channel, a square wave that is high when the case passed and low when it failed, with noise for
 * errors and a gap when it was not part of the run. Flaky probes show as busy waves.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Play } from 'lucide-react';

import { formatDateTime, useAsync } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import { Badge, Breadcrumb, Button, EmptyState, ErrorPanel, FilterSelect, LinkButton, Skeleton, StatusDot, TableWrap, type Tone } from '@x10/shared/ui';

import { useSize } from '../bench/hooks';
import { loadBench, loadBoard } from '../bench/load';
import type { Board, Reading } from '../bench/model';
import { fitText } from '../bench/text';
import { RUN_RULES } from '../config';
import { elapsedMs, formatMs, formatRate, historyPoints, passRate, runPhase, type HistoryPoint, type RunPhase } from '../domain/runs';
import { listSuites } from '../domain/suites';
import type { Schema } from '../model';
import { useRuns } from '../run-context';

const PHASE: Record<RunPhase, { tone: Tone; label: string }> = {
  running: { tone: 'info', label: 'Running' },
  done: { tone: 'neutral', label: 'Finished' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  interrupted: { tone: 'warn', label: 'Interrupted' },
};

/** /scope: open the first suite's scope. */
export function ScopeIndex() {
  const { store } = useApp<Schema>();
  const suites = useAsync(() => listSuites(store), [store]);
  if (suites.error) return <ErrorPanel error={suites.error} onRetry={() => void suites.reload()} />;
  if (!suites.data) return <ScopeSkeleton />;
  if (!suites.data.length)
    return (
      <EmptyState icon={<Activity />} title="Nothing to trace yet" action={<LinkButton to="/">Go to the bench</LinkButton>}>
        Create a suite and run it; every run adds a sweep to its scope.
      </EmptyState>
    );
  const withRuns = suites.data.find((s) => s.lastRun) ?? suites.data[0];
  return <Navigate to={`/suites/${withRuns.suite.id}/history`} replace />;
}

export function ScopePage() {
  const { suiteId = '' } = useParams();
  const [params] = useSearchParams();
  const focusCase = params.get('case');
  const { store } = useApp<Schema>();
  const navigate = useNavigate();
  const runsCtx = useRuns();
  const data = useAsync(async () => {
    const [bench, all] = await Promise.all([loadBoard(store, suiteId), loadBench(store)]);
    if (!bench.boards[0]) throw Object.assign(new Error('This suite was not found. It may have been deleted.'), { category: 'not_found' });
    return { board: bench.boards[0], suites: all.boards.map((b) => b.suite) };
  }, [store, suiteId, runsCtx.active?.done]);

  if (data.error && !data.data) return <ErrorPanel error={data.error} onRetry={() => void data.reload()} />;
  if (!data.data) return <ScopeSkeleton />;
  const { board, suites } = data.data;
  const suite = board.suite;
  const runs = board.runs;
  const points = historyPoints(runs);

  return (
    <>
      <Breadcrumb className="mb-2" items={[{ label: 'Bench', to: '/' }, { label: suite.name, to: `/suites/${suite.id}` }, { label: 'Oscilloscope' }]} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[18rem]">
          <h1 className="m-0 text-xl font-semibold md:text-2xl">Oscilloscope</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-muted num">
            <span className="font-medium text-fg">{suite.name}</span>
            <span>
              {runs.length} {runs.length === 1 ? 'run' : 'runs'}
              {runs.length > RUN_RULES.historyRuns ? ` · last ${RUN_RULES.historyRuns} shown` : ''}
            </span>
            <span>
              {board.probes.length} {board.probes.length === 1 ? 'channel' : 'channels'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {suites.length > 1 && (
            <FilterSelect
              label="Board"
              value={suite.id}
              onChange={(v) => navigate(`/suites/${v}/history`)}
              options={suites.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          <LinkButton to={`/suites/${suite.id}`}>Open board</LinkButton>
        </div>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          bordered
          icon={<Activity />}
          title="No sweeps yet"
          action={
            <Button
              variant="primary"
              icon={<Play />}
              disabled={runsCtx.busy || !board.probes.some((p) => p.testCase.enabled)}
              onClick={async () => {
                const id = await runsCtx.start(suite.id).catch(() => null);
                if (id) navigate(`/runs/${id}`);
              }}
            >
              Run suite
            </Button>
          }
        >
          Every run of this suite draws one sweep across the screen.
        </EmptyState>
      ) : (
        <>
          <div data-testid="history-chart">
            <Scope board={board} points={points} focusCase={focusCase} onPick={(p) => navigate(`/runs/${p.runId}`)} />
          </div>
          <h2 className="mb-2 mt-8 text-base font-semibold">Runs</h2>
          <TableWrap label="Runs">
            <table className="x-table" data-testid="runs-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Started</th>
                  <th scope="col">By</th>
                  <th scope="col" className="num">
                    Pass rate
                  </th>
                  <th scope="col" className="num">
                    Pass
                  </th>
                  <th scope="col" className="num">
                    Fail
                  </th>
                  <th scope="col" className="num">
                    Error
                  </th>
                  <th scope="col" className="num">
                    Elapsed
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => {
                  const ph = runPhase(r);
                  const rate = passRate(r);
                  return (
                    <tr key={r.id} data-testid="run-row">
                      <td>
                        <Link to={`/runs/${r.id}`} className="font-medium">
                          #{runs.length - i}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                      <td>{r.startedByName}</td>
                      <td className="num">
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot tone={rate === null ? 'neutral' : rate >= 1 ? 'ok' : rate >= 0.8 ? 'warn' : 'bad'} />
                          {formatRate(rate)}
                        </span>
                      </td>
                      <td className="num">{r.passCount}</td>
                      <td className="num">{r.failCount}</td>
                      <td className="num">{r.errorCount}</td>
                      <td className="num text-muted">{r.finishedAt ? formatMs(elapsedMs(r)) : '—'}</td>
                      <td>
                        <Badge tone={PHASE[ph].tone}>{PHASE[ph].label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
    </>
  );
}

function ScopeSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton width={220} height={14} />
      <Skeleton width={200} height={28} className="mt-3" />
      <Skeleton height={460} className="mt-5 rounded-2xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ the scope screen */

const STATUS_COLOR = { pass: 'var(--ok-solid)', fail: 'var(--bad-solid)', error: 'var(--warn-solid)' } as const;

function Scope({ board, points, focusCase, onPick }: { board: Board; points: HistoryPoint[]; focusCase: string | null; onPick: (p: HistoryPoint) => void }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(320, size.w);
  const narrow = w < 640;
  const labelW = narrow ? 118 : 248;
  const rightW = narrow ? 40 : 96;
  const x0 = labelW;
  const x1 = w - rightW;
  const n = points.length;
  const step = (x1 - x0) / Math.max(1, n);
  const xAt = (i: number) => x0 + step * (i + 0.5);
  const topPad = 62;
  const chH = narrow ? 120 : 150;
  const yRate = (pct: number) => topPad + chH - (pct / 100) * chH;
  const rowH = 36;
  const chTop = topPad + chH + 46;
  const probes = board.probes;
  const height = chTop + probes.length * rowH + 22;
  const runIds = new Set(points.map((p) => p.runId));
  const ordered = [...board.runs].reverse();
  // History arrays cover every run oldest first; keep the runs on screen.
  const keep = ordered.map((r) => runIds.has(r.id));
  const histories = probes.map((p) => p.history.filter((_, i) => keep[i]));

  const rated = points.map((p, i) => ({ p, i })).filter((x) => x.p.passRate !== null);
  const pathA = rated.map(({ p, i }, k) => `${k ? 'L' : 'M'}${xAt(i)} ${yRate(p.passRate!)}`).join('');
  const last = rated[rated.length - 1]?.p.passRate ?? null;
  const mean = rated.length ? rated.reduce((s, x) => s + x.p.passRate!, 0) / rated.length : null;
  const summary = rated.length
    ? `Pass rate for the last ${n} runs, oldest first: ${rated.map(({ p }) => `${p.label} ${p.passRate}%`).join(', ')}.`
    : 'No runs with results yet.';

  return (
    <figure className="m-0">
      <div
        ref={ref}
        className="relative overflow-hidden rounded-2xl border border-line shadow-1"
        style={{ background: 'var(--scope-bg)' }}
        onMouseLeave={() => setHover(null)}
      >
        {size.w > 0 && (
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="block" role="img" aria-label={summary}>
            <defs>
              <linearGradient id="scope-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--scope-trace)" stopOpacity={0.22} />
                <stop offset="1" stopColor="var(--scope-trace)" stopOpacity={0} />
              </linearGradient>
              <filter id="scope-glow" x="-5%" y="-30%" width="110%" height="160%">
                <feGaussianBlur stdDeviation="3" />
              </filter>
            </defs>
            {/* header readouts */}
            <text x={16} y={26} className="font-mono" fontSize={11} letterSpacing="0.1em" fill="var(--scope-muted)">
              {narrow ? 'CH A' : 'CH A · PASS RATE'}
            </text>
            <text x={w - 16} y={26} textAnchor="end" className="font-mono" fontSize={11} letterSpacing="0.06em" fill="var(--scope-ink)">
              {`LAST ${last === null ? '—' : `${Math.round(last)}%`}  ·  MEAN ${mean === null ? '—' : `${Math.round(mean)}%`}${narrow ? '' : `  ·  ${n} ${n === 1 ? 'SWEEP' : 'SWEEPS'}`}`}
            </text>

            {/* graticule */}
            <g stroke="var(--scope-grid)" strokeWidth={1}>
              {[0, 25, 50, 75, 100].map((v) => (
                <line key={v} x1={x0} x2={x1} y1={yRate(v)} y2={yRate(v)} strokeDasharray={v === 0 || v === 100 ? undefined : '2 4'} stroke={v === 0 || v === 100 ? 'var(--scope-grid-strong)' : undefined} />
              ))}
              {points.map((_, i) => (
                <line key={i} x1={xAt(i)} x2={xAt(i)} y1={topPad} y2={height - 14} strokeDasharray="2 4" />
              ))}
            </g>
            {[0, 50, 100].map((v) => (
              <text key={v} x={x0 - 10} y={yRate(v) + 4} textAnchor="end" className="font-mono" fontSize={10.5} fill="var(--scope-muted)">
                {v}%
              </text>
            ))}

            {/* hover column */}
            {hover !== null && <rect x={xAt(hover) - step / 2} y={topPad - 8} width={step} height={height - topPad - 6} fill="var(--scope-trace)" opacity={0.08} />}

            {/* channel A */}
            {pathA && (
              <>
                <path d={`${pathA}L${xAt(rated[rated.length - 1].i)} ${yRate(0)}L${xAt(rated[0].i)} ${yRate(0)}Z`} fill="url(#scope-fill)" />
                <path d={pathA} fill="none" stroke="var(--scope-trace)" strokeWidth={6} opacity={0.35} filter="url(#scope-glow)" />
                <path d={pathA} fill="none" stroke="var(--scope-trace)" strokeWidth={2} strokeLinejoin="round" />
              </>
            )}
            {points.map((p, i) =>
              p.passRate === null ? null : (
                <g key={p.runId} style={{ cursor: 'pointer' }} onClick={() => onPick(p)} data-testid="history-point" data-run-id={p.runId} onMouseEnter={() => setHover(i)}>
                  <circle cx={xAt(i)} cy={yRate(p.passRate)} r={16} fill="transparent" />
                  <circle cx={xAt(i)} cy={yRate(p.passRate)} r={hover === i ? 6.5 : 5} fill="var(--scope-bg)" stroke="var(--scope-trace)" strokeWidth={2.5} />
                  <text x={xAt(i)} y={yRate(p.passRate) - 12} textAnchor="middle" className="font-mono" fontSize={11} fill="var(--scope-ink)">
                    {Math.round(p.passRate)}%
                  </text>
                </g>
              ),
            )}
            {/* run labels */}
            {points.map((p, i) => (
              <text key={p.runId} x={xAt(i)} y={topPad + chH + 22} textAnchor="middle" className="font-mono" fontSize={10.5} fill={hover === i ? 'var(--scope-ink)' : 'var(--scope-muted)'}>
                {p.label}
              </text>
            ))}

            {/* probe channels */}
            <text x={16} y={chTop - 10} className="font-mono" fontSize={11} letterSpacing="0.1em" fill="var(--scope-muted)">
              PROBES
            </text>
            {!narrow && (
              <text x={w - 16} y={chTop - 10} textAnchor="end" className="font-mono" fontSize={11} letterSpacing="0.1em" fill="var(--scope-muted)">
                FLIPS
              </text>
            )}
            {probes.map((p, row) => {
              const top = chTop + row * rowH;
              const hi = top + 9;
              const lo = top + rowH - 9;
              const mid = (hi + lo) / 2;
              const h = histories[row];
              const focused = focusCase === p.testCase.id;
              const dim = focusCase && !focused;
              const segs = h.map((s: Reading, i) => ({ s, a: xAt(i) - step / 2, b: xAt(i) + step / 2 }));
              return (
                <g key={p.testCase.id} opacity={dim ? 0.45 : 1} data-testid="scope-channel" data-case-id={p.testCase.id}>
                  {focused && <rect x={8} y={top + 1} width={w - 16} height={rowH - 2} rx={6} fill="var(--scope-trace)" opacity={0.12} />}
                  <line x1={x0} x2={x1} y1={top + rowH} y2={top + rowH} stroke="var(--scope-grid)" />
                  <text x={16} y={mid + 4} fontSize={12.5} fontWeight={focused ? 600 : 400} fill="var(--scope-ink)">
                    {fitText(p.testCase.name, labelW - 30, 12.5, { weight: focused ? 600 : 400 })}
                  </text>
                  {segs.map(({ s, a, b }, i) => {
                    if (s === null) return <line key={i} x1={a + 3} x2={b - 3} y1={mid} y2={mid} stroke="var(--scope-muted)" strokeDasharray="2 5" opacity={0.6} />;
                    const y = s === 'pass' ? hi : lo;
                    const prev = segs[i - 1]?.s;
                    const edge = prev && prev !== s && prev !== 'error' && s !== 'error' ? <line x1={a} x2={a} y1={hi} y2={lo} stroke="var(--scope-trace)" strokeOpacity={0.6} strokeWidth={1.5} /> : null;
                    if (s === 'error') {
                      const teeth = Math.max(4, Math.floor((b - a) / 7));
                      const zig = Array.from({ length: teeth }, (_, k) => `${k ? 'L' : 'M'}${a + ((b - a) * k) / (teeth - 1)} ${k % 2 ? hi + 3 : lo - 3}`).join('');
                      return (
                        <g key={i}>
                          <path d={zig} fill="none" stroke={STATUS_COLOR.error} strokeWidth={1.75} strokeLinejoin="round" />
                        </g>
                      );
                    }
                    return (
                      <g key={i}>
                        {edge}
                        <line x1={a} x2={b} y1={y} y2={y} stroke={STATUS_COLOR[s]} strokeWidth={6} opacity={0.3} filter="url(#scope-glow)" />
                        <line x1={a} x2={b} y1={y} y2={y} stroke={STATUS_COLOR[s]} strokeWidth={2.25} strokeLinecap="round" />
                      </g>
                    );
                  })}
                  <text x={w - 16} y={mid + 4} textAnchor="end" className="font-mono" fontSize={12} fill={p.flips ? 'var(--scope-ink)' : 'var(--scope-muted)'}>
                    {p.flips}
                  </text>
                </g>
              );
            })}

            {/* hover targets per run column */}
            {points.map((p, i) => (
              <rect key={p.runId} x={xAt(i) - step / 2} y={chTop - 4} width={step} height={height - chTop} fill="transparent" style={{ cursor: 'pointer' }} onMouseEnter={() => setHover(i)} onClick={() => onPick(p)} />
            ))}
          </svg>
        )}
        {hover !== null && points[hover] && (
          <div className="pointer-events-none absolute top-9 rounded-lg px-2.5 py-1.5 font-mono text-[11px] shadow-1" style={{ left: Math.min(Math.max(8, xAt(hover) - 90), w - 190), background: 'var(--scope-ink)', color: 'var(--scope-bg)' }}>
            {points[hover].label} · {formatDateTime(points[hover].startedAt)} · {points[hover].pass}/{points[hover].pass + points[hover].fail + points[hover].error} pass
          </div>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-ok-solid" /> high: pass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-bad-solid" /> low: fail
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-warn-solid" /> noise: error
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed border-line-strong" /> not in the run
        </span>
        <span className="sr-only">{summary}</span>
      </figcaption>
    </figure>
  );
}
