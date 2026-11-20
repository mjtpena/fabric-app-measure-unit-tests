/** The bench as a table: the accessible equivalent of the boards, same data, one row per probe. */
import { Link } from 'react-router-dom';

import { Badge, cx, EmptyState, Table, TableWrap, Td, Th, Tr, useIsDesktop, type Tone } from '@x10/shared/ui';

import { KIND_INFO } from '../domain/compare';
import { formatMs } from '../domain/runs';
import { STATE_LABEL } from './lenses';
import { formatReading, probeState, type BenchData, type ProbeState } from './model';

const TONE: Record<ProbeState, Tone> = { pass: 'ok', fail: 'bad', error: 'warn', off: 'neutral', idle: 'neutral' };

export function BenchList({ bench, focusId, onOpen }: { bench: BenchData; focusId?: string | null; onOpen: (caseId: string, suiteId: string) => void }) {
  const desktop = useIsDesktop();
  if (!bench.boards.length) return <EmptyState title="The bench is empty">Create a suite to put its first board on the bench.</EmptyState>;
  return (
    <div className="flex flex-col gap-8" data-testid="bench-list">
      {bench.boards.map((b) => (
        <section key={b.suite.id} aria-labelledby={`board-${b.suite.id}`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id={`board-${b.suite.id}`} className="m-0 text-lg font-semibold">
              <Link to={`/suites/${b.suite.id}`} className="text-fg no-underline hover:underline">
                {b.suite.name}
              </Link>
            </h2>
            <span className="text-ui text-muted num">
              {b.probes.length} {b.probes.length === 1 ? 'probe' : 'probes'} · {b.chips.length} {b.chips.length === 1 ? 'chip' : 'chips'} · owner {b.suite.createdByName}
            </span>
          </div>
          {b.probes.length === 0 ? (
            <EmptyState compact bordered title="No probes on this board">
              The owner adds cases from the board page.
            </EmptyState>
          ) : !desktop ? (
            <ul className="m-0 list-none divide-y divide-[var(--line)] rounded-xl border border-line bg-surface p-0" aria-label={`${b.suite.name} probes`}>
              {b.probes.map((p) => {
                const s = probeState(p);
                return (
                  <li key={p.testCase.id} data-testid="bench-row" data-state={s} className={cx('flex items-start gap-3 px-4 py-3', p.testCase.id === focusId && 'bg-accent-2')}>
                    <div className="min-w-0 flex-1">
                      <button type="button" className="x-tap cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-medium text-fg" onClick={() => onOpen(p.testCase.id, b.suite.id)}>
                        {p.testCase.name}
                      </button>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        <span className="font-mono">{p.chip.label}</span> · {KIND_INFO[p.testCase.kind].label}
                        {p.last ? ` · ${formatMs(p.last.durationMs)}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={TONE[s]}>{STATE_LABEL[s]}</Badge>
                      <span className={cx('font-mono text-xs num', p.gap ? 'text-bad-text' : 'text-muted')}>{p.gap?.text ?? (p.last?.actual != null ? formatReading(p.last.actual) : '—')}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <TableWrap label={`${b.suite.name} probes`}>
              <Table density="compact">
                <thead>
                  <tr>
                    <Th>Probe</Th>
                    <Th>Chip</Th>
                    <Th>Kind</Th>
                    <Th>Status</Th>
                    <Th numeric>Expected</Th>
                    <Th numeric>Actual</Th>
                    <Th numeric>Gap</Th>
                    <Th numeric>Duration</Th>
                    <Th numeric>Flips</Th>
                  </tr>
                </thead>
                <tbody>
                  {b.probes.map((p) => {
                    const s = probeState(p);
                    const seen = p.history.filter((h) => h !== null).length;
                    return (
                      <Tr key={p.testCase.id} selected={p.testCase.id === focusId} data-testid="bench-row" data-state={s}>
                        <Td className="min-w-[220px]">
                          <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-fg hover:underline" onClick={() => onOpen(p.testCase.id, b.suite.id)}>
                            {p.testCase.name}
                          </button>
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-ui">{p.chip.label}</Td>
                        <Td muted>{KIND_INFO[p.testCase.kind].label}</Td>
                        <Td>
                          <Badge tone={TONE[s]}>{STATE_LABEL[s]}</Badge>
                        </Td>
                        <Td numeric>{p.testCase.kind === 'notblank' ? <span className="text-muted">a value</span> : (p.testCase.expected ?? '—')}</Td>
                        <Td numeric className={cx(s === 'fail' && 'text-bad-text')}>{p.last?.actual != null ? formatReading(p.last.actual) : '—'}</Td>
                        <Td numeric className={cx(p.gap && 'text-bad-text')}>{p.gap?.text ?? '—'}</Td>
                        <Td numeric>{p.last ? formatMs(p.last.durationMs) : '—'}</Td>
                        <Td numeric>{seen < 2 ? '—' : `${p.flips}/${seen - 1}`}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </section>
      ))}
    </div>
  );
}
