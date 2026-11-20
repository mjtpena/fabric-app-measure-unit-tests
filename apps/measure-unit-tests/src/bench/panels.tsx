/** Instrument panels that float over the bench: the probe readout and the live run monitor. */
import { Activity, ArrowRight, Pencil, X, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useNow } from '@x10/shared/lib';
import { Button, cx, FloatingPanel, IconButton, LinkButton, StatusDot, type Tone } from '@x10/shared/ui';

import { KIND_INFO } from '../domain/compare';
import { formatMs } from '../domain/runs';
import { explainShort } from '../domain/shorts';
import type { ActiveRun } from '../run-context';
import { kindLine, STATE_LABEL } from './lenses';
import { formatReading, probeState, type Probe, type ProbeState, type Reading } from './model';

const TONE: Record<ProbeState, Tone> = { pass: 'ok', fail: 'bad', error: 'warn', off: 'neutral', idle: 'neutral' };

/** Past readings as a row of small cells, oldest first. */
export function HistoryCells({ history, className }: { history: Reading[]; className?: string }) {
  const cells = history.slice(-12);
  if (!cells.length) return <span className="text-xs text-muted">No runs yet</span>;
  return (
    <span className={cx('inline-flex items-center gap-[3px]', className)} aria-label={`Last ${cells.length} runs: ${cells.map((c) => c ?? 'not run').join(', ')}`} role="img">
      {cells.map((c, i) => (
        <span
          key={i}
          className={cx(
            'inline-block h-3.5 w-2 rounded-[2px]',
            c === 'pass' && 'bg-ok-solid',
            c === 'fail' && 'bg-bad-solid',
            c === 'error' && 'bg-warn-solid',
            c === null && 'border border-dashed border-line-strong',
          )}
        />
      ))}
    </span>
  );
}

function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-ui text-muted">{label}</dt>
      <dd className={cx('m-0 min-w-0 truncate text-right font-mono text-ui num', tone === 'bad' && 'text-bad-text', tone === 'warn' && 'text-warn-text')}>{children}</dd>
    </div>
  );
}

/** Phones: a one-glance readout over the stage (the full readout sits below the stage). */
export function CompactReadout({ probe, onOpen, onClose, canEdit }: { probe: Probe; onOpen: () => void; onClose: () => void; canEdit: boolean }) {
  const state = probeState(probe);
  const last = probe.last;
  const line = probe.gap ? `${probe.gap.versus} · ${probe.gap.text}` : last?.status === 'error' ? explainShort(last.message).title : last?.actual != null ? formatReading(last.actual) : STATE_LABEL[state];
  return (
    <FloatingPanel padding="none" className="flex items-center gap-3 px-3 py-2.5" data-testid="bench-readout-compact">
      <StatusDot tone={TONE[state]} size={9} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui font-semibold">{probe.testCase.name}</div>
        <div className={cx('truncate font-mono text-[11.5px] num', state === 'fail' ? 'text-bad-text' : state === 'error' ? 'text-warn-text' : 'text-muted')}>{line}</div>
      </div>
      <Button size="sm" variant="primary" onClick={onOpen}>
        {canEdit ? 'Open' : 'View'}
      </Button>
      <IconButton size="sm" label="Close readout" icon={<X />} onClick={onClose} className="-mr-1" />
    </FloatingPanel>
  );
}

/** The focused probe: what it checks, what came back, how it has behaved. */
export function ProbeReadout({
  probe,
  suiteName,
  canEdit,
  onOpen,
  onClose,
  className,
}: {
  probe: Probe;
  suiteName: string;
  canEdit: boolean;
  onOpen: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const c = probe.testCase;
  const state = probeState(probe);
  const last = probe.last;
  const seen = probe.history.filter((h) => h !== null).length;
  const short = last?.status === 'error' ? explainShort(last.message) : null;
  return (
    <FloatingPanel padding="none" className={cx('w-full px-4 pt-3 pb-4', className)} data-testid="bench-readout" aria-label={`Readout: ${c.name}`} role="region">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="x-legend-label truncate text-muted">
            {probe.chip.label} · {suiteName}
          </div>
          <h2 className="m-0 mt-1 text-base font-semibold leading-5">{c.name}</h2>
        </div>
        {onClose && <IconButton size="sm" label="Close readout" icon={<X />} onClick={onClose} className="-mr-2 -mt-1" />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <StatusDot tone={TONE[state]} />
          {STATE_LABEL[state]}
        </span>
        <span className="text-muted">{KIND_INFO[c.kind].label}</span>
        {last && <span className="font-mono text-muted num">{formatMs(last.durationMs)}</span>}
      </div>
      <dl className="m-0 mt-3 border-t border-line pt-2">
        <Row label="Expected">{c.kind === 'notblank' ? 'a value' : (c.expected ?? '—')}</Row>
        {c.tolerance && <Row label="Tolerance">± {c.tolerance}</Row>}
        <Row label="Actual" tone={state === 'fail' ? 'bad' : undefined}>
          {last?.actual != null ? formatReading(last.actual) : '—'}
        </Row>
        {probe.gap && (
          <Row label="Gap" tone="bad">
            {probe.gap.text}
          </Row>
        )}
      </dl>
      {short ? (
        <p className="m-0 mt-2 text-ui text-warn-text">{short.title}</p>
      ) : (
        last?.message && state !== 'pass' && <p className="m-0 mt-2 text-ui text-muted">{last.message}</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <HistoryCells history={probe.history} />
        <span className="font-mono text-[11px] text-muted num">
          {seen < 2 ? kindLine(probe) : probe.flips ? `${probe.flips} ${probe.flips === 1 ? 'flip' : 'flips'} / ${seen} runs` : `stable / ${seen} runs`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon={<Pencil />} onClick={onOpen}>
          {canEdit ? 'Open probe' : 'View probe'}
        </Button>
        <LinkButton size="sm" to={`/suites/${probe.suiteId}/history?case=${c.id}`} icon={<Activity />}>
          Oscilloscope
        </LinkButton>
        {short && (
          <LinkButton size="sm" variant="ghost" to={`/shorts#${c.id}`} icon={<Zap />}>
            Short circuit
          </LinkButton>
        )}
      </div>
    </FloatingPanel>
  );
}

/** Live run monitor: an LED strip that fills as results stream in, the counts, cancel and a link to the results. */
export function RunMonitor({ active, suiteName, onCancel, onDismiss, className }: { active: ActiveRun; suiteName: string; onCancel: () => void; onDismiss: () => void; className?: string }) {
  const running = !active.done;
  const now = useNow(running ? 200 : 60_000);
  const byCase = new Map(active.results.map((r) => [r.caseId, r]));
  const pass = active.results.filter((r) => r.status === 'pass').length;
  const fail = active.results.filter((r) => r.status === 'fail').length;
  const error = active.results.filter((r) => r.status === 'error').length;
  const started = new Date(active.run.startedAt).getTime();
  const end = active.done && active.run.finishedAt ? new Date(active.run.finishedAt).getTime() : now.getTime();
  const inflight = new Set(active.caseIds.filter((id) => !byCase.has(id)).slice(0, running && !active.cancelling ? 2 : 0));
  return (
    <FloatingPanel padding="none" className={cx('w-full px-4 py-3', className)} data-testid="run-monitor" role="region" aria-label="Run monitor">
      <div className="flex items-center gap-2">
        <span className={cx('inline-block size-2 rounded-full', running ? 'bg-accent-9 animate-pulse' : fail || error ? 'bg-bad-solid' : 'bg-ok-solid')} aria-hidden="true" />
        <span className="x-legend-label min-w-0 flex-1 truncate text-muted">
          {running ? (active.cancelling ? 'Cancelling' : 'Live run') : active.run.status === 'cancelled' ? 'Run cancelled' : 'Run finished'} · {suiteName}
        </span>
        {running ? (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={active.cancelling}>
            {active.cancelling ? 'Cancelling' : 'Cancel'}
          </Button>
        ) : (
          <IconButton size="sm" label="Close run monitor" icon={<X />} onClick={onDismiss} className="-mr-2" />
        )}
      </div>
      <div className="mt-2.5 flex gap-1" role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={active.total} aria-valuenow={active.results.length}>
        {active.caseIds.map((id) => {
          const r = byCase.get(id);
          return (
            <span
              key={id}
              className={cx(
                'h-2 min-w-0 flex-1 rounded-full transition-colors duration-200',
                r?.status === 'pass' && 'bg-ok-solid',
                r?.status === 'fail' && 'bg-bad-solid',
                r?.status === 'error' && 'bg-warn-solid',
                !r && inflight.has(id) && 'animate-pulse bg-accent-9',
                !r && !inflight.has(id) && 'bg-gray-4',
              )}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui">
        <span className="font-semibold num" data-testid="monitor-progress">
          {active.results.length} of {active.total}
        </span>
        <span className="inline-flex items-center gap-1 num">
          <StatusDot tone="ok" /> {pass}
        </span>
        <span className="inline-flex items-center gap-1 num">
          <StatusDot tone="bad" /> {fail}
        </span>
        <span className="inline-flex items-center gap-1 num">
          <StatusDot tone="warn" /> {error}
        </span>
        <span className="ml-auto font-mono text-muted num">{formatMs(Math.max(0, end - started))}</span>
      </div>
      <Link to={`/runs/${active.run.id}`} className="mt-2 inline-flex items-center gap-1 text-ui font-medium text-accent-11 no-underline hover:underline">
        Open run results <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </FloatingPanel>
  );
}
