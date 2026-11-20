/**
 * Short circuit: every probe whose last reading was an error, with the cause in plain words, the model's own message
 * and the fix. Below, the guide to every kind of short the bench can show.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircuitBoard, Pencil, Zap } from 'lucide-react';

import { formatRelative, useAsync } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import { Button, ErrorPanel, PageHeader, Skeleton, Stat, StatStrip, Tag, cx } from '@x10/shared/ui';

import { loadBench } from '../bench/load';
import type { Probe } from '../bench/model';
import { CaseDrawer } from '../components/CaseDrawer';
import { updateCase } from '../domain/cases';
import { explainShort, SHORT_GUIDE, type ShortCause } from '../domain/shorts';
import { canEditSuite } from '../domain/suites';
import type { Schema } from '../model';
import { useModelClient } from '../model-client';

/** A broken trace with a spark: chip, gap, probe. */
function SparkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 40" className={className} aria-hidden="true">
      <rect x={2} y={10} width={22} height={20} rx={3} fill="var(--pcb-chip)" />
      <rect x={24} y={18.5} width={4} height={3} fill="var(--pcb-pin)" />
      <path d="M28 20h8" stroke="var(--pcb-copper)" strokeWidth={2} strokeLinecap="round" />
      <path d="M44 20h12" stroke="var(--pcb-copper)" strokeWidth={2} strokeLinecap="round" />
      <path d="M41 9l-4 9h5l-4 10" fill="none" stroke="var(--warn-solid)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={63} cy={20} r={7} fill="var(--pcb-copper)" />
      <circle cx={63} cy={20} r={4.5} fill="var(--warn-solid)" />
    </svg>
  );
}

export function ShortCircuitPage() {
  const { store, me } = useApp<Schema>();
  const client = useModelClient();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const data = useAsync(() => loadBench(store), [store]);
  const [open, setOpen] = useState<Probe | null>(null);

  useEffect(() => {
    if (!data.data || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [data.data, hash]);

  if (data.error && !data.data) return <ErrorPanel error={data.error} onRetry={() => void data.reload()} />;
  if (!data.data)
    return (
      <div role="status" aria-label="Loading">
        <Skeleton width={200} height={28} />
        <Skeleton height={84} className="mt-6 rounded-xl" />
        <Skeleton height={180} className="mt-6 rounded-xl" />
      </div>
    );

  const bench = data.data;
  const shorts = bench.probes
    .filter((p) => p.testCase.enabled && p.last?.status === 'error')
    .map((p) => ({ probe: p, info: explainShort(p.last?.message), board: bench.boards.find((b) => b.suite.id === p.suiteId)! }));
  const causes = new Map<ShortCause, number>();
  for (const s of shorts) causes.set(s.info.cause, (causes.get(s.info.cause) ?? 0) + 1);
  const boards = new Set(shorts.map((s) => s.probe.suiteId)).size;
  const checked = bench.boards.map((b) => b.lastRun?.startedAt).filter(Boolean).sort().pop();

  return (
    <>
      <PageHeader
        title="Short circuit"
        meta={
          <>
            <span>Probes whose last reading was an error, and why</span>
            <span>{client.label}</span>
          </>
        }
      />
      <StatStrip columns={4} className="mb-8">
        <Stat label="Shorts now" value={shorts.length} tone={shorts.length ? 'warn' : 'ok'} />
        <Stat label="Probes powered" value={bench.probes.filter((p) => p.testCase.enabled).length} />
        <Stat label="Boards affected" value={`${boards} of ${bench.boards.length}`} />
        <Stat label="Last reading" value={checked ? formatRelative(checked) : '—'} size="sm" />
      </StatStrip>

      {shorts.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong/70 px-6 py-12 text-center" data-testid="shorts-empty">
          <div className="mb-4 grid size-11 place-items-center rounded-xl bg-ok-soft text-ok-text">
            <CircuitBoard className="size-5" aria-hidden="true" />
          </div>
          <p className="m-0 text-base font-semibold">No short circuits</p>
          <p className="m-0 mt-1 max-w-[46ch] text-sm text-muted">Every enabled probe reached the model in its last reading. Errors land here with the cause and the fix.</p>
        </div>
      ) : (
        <ol className="m-0 list-none divide-y divide-[var(--line)] border-y border-line p-0" data-testid="shorts">
          {shorts.map(({ probe, info, board }) => {
            const seen = probe.history.filter((h) => h !== null).length;
            const shorted = probe.history.filter((h) => h === 'error').length;
            return (
              <li key={probe.testCase.id} id={probe.testCase.id} className="grid scroll-mt-24 gap-x-5 gap-y-3 py-6 sm:grid-cols-[88px_minmax(0,1fr)]" data-testid="short">
                <div className="grid h-14 w-[88px] place-items-center rounded-xl" style={{ background: 'var(--pcb-board)' }}>
                  <SparkGlyph className="h-10 w-[72px]" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-lg font-semibold">{info.title}</h2>
                    {info.category && (
                      <Tag mono size="sm">
                        {info.category}
                      </Tag>
                    )}
                  </div>
                  <p className="m-0 mt-1 text-ui text-muted">
                    {probe.testCase.name} · {board.suite.name} board · {probe.chip.label}
                  </p>
                  <p className="m-0 mt-3 max-w-[70ch] text-sm">{info.explanation}</p>
                  <p className="m-0 mt-1.5 max-w-[70ch] text-sm">
                    <span className="font-medium">Fix: </span>
                    {info.fix}
                  </p>
                  <div className="mt-3 rounded-lg bg-surface-sunken px-3 py-2.5">
                    <div className="x-legend-label mb-1 text-muted">The model said</div>
                    <p className="m-0 break-words font-mono text-ui">{info.detail}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="primary" icon={<Pencil />} onClick={() => setOpen(probe)}>
                      {canEditSuite(me, board.suite) ? 'Open probe' : 'View probe'}
                    </Button>
                    <Button size="sm" icon={<Zap />} onClick={() => navigate(`/?probe=${probe.testCase.id}`)}>
                      Show on bench
                    </Button>
                    <span className="ml-auto text-xs text-muted num">
                      shorted in {shorted} of {seen} {seen === 1 ? 'run' : 'runs'}
                      {probe.last ? ` · ${formatRelative(probe.last.createdAt)}` : ''}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <section className="mt-12" aria-labelledby="guide">
        <h2 id="guide" className="m-0 mb-3 text-base font-semibold">
          Kinds of short
        </h2>
        <dl className="m-0 grid gap-x-10 border-t border-line sm:grid-cols-2">
          {(Object.keys(SHORT_GUIDE) as ShortCause[])
            .filter((c) => c !== 'unknown' && c !== 'cancelled')
            .map((c) => {
              const n = causes.get(c) ?? 0;
              return (
                <div key={c} className="border-b border-line py-3.5">
                  <dt className={cx('flex items-center gap-2 text-sm font-medium', n > 0 && 'text-warn-text')}>
                    {SHORT_GUIDE[c].title}
                    {n > 0 && <span className="rounded-full bg-warn-soft px-1.5 font-mono text-[11px] num">{n} now</span>}
                  </dt>
                  <dd className="m-0 mt-1 text-ui text-muted">
                    {SHORT_GUIDE[c].explanation} {SHORT_GUIDE[c].fix}
                  </dd>
                </div>
              );
            })}
        </dl>
      </section>

      <CaseDrawer
        open={!!open}
        onClose={() => setOpen(null)}
        testCase={open?.testCase ?? null}
        canEdit={!!open && canEditSuite(me, bench.boards.find((b) => b.suite.id === open.suiteId)!.suite)}
        boardName={open ? bench.boards.find((b) => b.suite.id === open.suiteId)?.suite.name : undefined}
        onSave={async (input) => {
          if (open) await updateCase(store, me, open.testCase.id, input);
          await data.reload();
        }}
      />
    </>
  );
}
