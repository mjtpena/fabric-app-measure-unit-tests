/** The board page: one suite's board close up, its probes as a table, and the actions that run and edit it. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, Lock, Pencil, Play, Plus, Trash2 } from 'lucide-react';

import { describeError, formatDate, formatRelative, plural, useAction, useAsync, type AppErrorInfo } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import {
  Badge,
  Breadcrumb,
  Button,
  ConfirmDialog,
  cx,
  EmptyState,
  ErrorPanel,
  InlineError,
  LinkButton,
  Skeleton,
  StatusDot,
  Switch,
  TableWrap,
  type Tone,
} from '@x10/shared/ui';

import { BoardView } from '../bench/BoardView';
import { STATE_LABEL } from '../bench/lenses';
import { liveView } from '../bench/live';
import { loadBoard } from '../bench/load';
import { probeState, stateCounts, type Board, type ProbeState } from '../bench/model';
import { CaseDrawer } from '../components/CaseDrawer';
import { SuiteDialog } from '../components/SuiteDialog';
import { KIND_INFO } from '../domain/compare';
import { createCase, deleteCase, setCaseEnabled, updateCase } from '../domain/cases';
import { formatMs } from '../domain/runs';
import { canEditSuite, deleteSuite, getSuite, updateSuite } from '../domain/suites';
import type { Schema, TestCase } from '../model';
import { useModelClient } from '../model-client';
import { useRuns } from '../run-context';

const TONE: Record<ProbeState, Tone> = { pass: 'ok', fail: 'bad', error: 'warn', off: 'neutral', idle: 'neutral' };

export function SuiteDetailPage() {
  const { suiteId = '' } = useParams();
  const { store, me } = useApp<Schema>();
  const client = useModelClient();
  const runs = useRuns();
  const navigate = useNavigate();
  const data = useAsync(async () => {
    const [suite, bench] = await Promise.all([getSuite(store, suiteId), loadBoard(store, suiteId)]);
    return { suite, board: bench.boards[0] };
  }, [store, suiteId]);
  const [drawer, setDrawer] = useState<{ open: boolean; testCase: TestCase | null }>({ open: false, testCase: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [runError, setRunError] = useState<AppErrorInfo | null>(null);
  const toggle = useAction(async (id: string, enabled: boolean) => {
    await setCaseEnabled(store, me, id, enabled);
    if (!enabled) setSelected((s) => new Set([...s].filter((x) => x !== id)));
    await data.reload();
  });

  const start = async (caseIds?: string[]) => {
    setRunError(null);
    try {
      const runId = await runs.start(suiteId, caseIds);
      navigate(`/runs/${runId}`);
    } catch (e) {
      setRunError(describeError(e));
    }
  };

  if (data.error && !data.data) return <ErrorPanel error={data.error} onRetry={() => void data.reload()} />;
  if (!data.data) return <BoardSkeleton />;

  const { suite, board } = data.data;
  const canEdit = canEditSuite(me, suite);
  const cases = board.probes;
  const enabled = cases.filter((c) => c.testCase.enabled);
  const chosen = enabled.filter((c) => selected.has(c.testCase.id)).map((c) => c.testCase.id);
  const runningHere = !!runs.active && !runs.active.done && runs.active.run.suiteId === suite.id;
  const counts = stateCounts(cases);
  const live = runningHere ? liveView(runs.active) : null;

  return (
    <>
      <Breadcrumb items={[{ label: 'Bench', to: '/' }, { label: suite.name }]} className="mb-2" />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[20rem]">
          <h1 className="m-0 text-xl font-semibold break-words md:text-2xl">{suite.name}</h1>
          {suite.description && <p className="m-0 mt-1.5 max-w-[72ch] text-sm text-muted">{suite.description}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ui text-muted">
            <span className="inline-flex items-center gap-x-3 num">
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="ok" /> {counts.pass} pass
              </span>
              {counts.fail > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="bad" /> {counts.fail} fail
                </span>
              )}
              {counts.error > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="warn" /> {counts.error} error
                </span>
              )}
              {counts.off > 0 && <span>{counts.off} off</span>}
            </span>
            <span>
              Owner {suite.createdByName} · created {formatDate(suite.createdAt)}
            </span>
            <span>{board.lastRun ? `Last run ${formatRelative(board.lastRun.startedAt)}` : 'Never run'}</span>
            {!canEdit && (
              <span className="inline-flex items-center gap-1">
                <Lock className="size-3.5" aria-hidden="true" /> Read only
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton to={`/suites/${suite.id}/history`} icon={<Activity />}>
            Oscilloscope
          </LinkButton>
          {canEdit && (
            <Button icon={<Pencil />} onClick={() => setEditing(true)}>
              Edit suite
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" icon={<Trash2 />} className="text-bad-text" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {cases.length > 0 && (
        <BoardView
          board={board}
          modelLabel={client.label}
          live={live}
          maxHeight={460}
          label={`${suite.name} board: ${cases.length} probes, ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error`}
          onProbe={(id) => {
            const c = cases.find((p) => p.testCase.id === id);
            if (c) setDrawer({ open: true, testCase: c.testCase });
          }}
        />
      )}

      <div
        role="toolbar"
        aria-label="Suite actions"
        className="x-glass sticky z-20 mt-5 mb-4 flex flex-wrap items-center gap-2 rounded-2xl! px-3 py-2.5 md:static md:rounded-none! md:border-0! md:bg-transparent! md:p-0 md:shadow-none! md:backdrop-blur-none!"
        style={{ bottom: 'calc(var(--x-bottom-inset) + 12px)' }}
      >
        <Button variant="primary" icon={<Play />} onClick={() => void start()} disabled={runs.busy || !enabled.length} busy={runningHere}>
          Run suite
        </Button>
        <Button onClick={() => void start(chosen)} disabled={runs.busy || !chosen.length}>
          Run selected{chosen.length ? ` (${chosen.length})` : ''}
        </Button>
        {canEdit && (
          <Button icon={<Plus />} onClick={() => setDrawer({ open: true, testCase: null })}>
            Add case
          </Button>
        )}
        <span className="ml-auto hidden text-ui text-muted md:inline num">
          {plural(cases.length, 'case')} · {enabled.length} enabled
        </span>
        {runs.busy && runs.active && (
          <LinkButton size="sm" variant="ghost" to={`/runs/${runs.active.run.id}`}>
            Run in progress
          </LinkButton>
        )}
      </div>
      {runError && (
        <div className="mb-4">
          <InlineError error={runError} />
        </div>
      )}

      {cases.length === 0 ? (
        <EmptyState
          bordered
          title="No probes on this board"
          action={
            canEdit ? (
              <Button variant="primary" icon={<Plus />} onClick={() => setDrawer({ open: true, testCase: null })}>
                Add case
              </Button>
            ) : undefined
          }
        >
          {canEdit ? 'Point a probe at a key measure such as [Total Sales]; Measure mode writes the DAX.' : 'The suite owner has not added any cases yet.'}
        </EmptyState>
      ) : (
        <CasesTable
          board={board}
          canEdit={canEdit}
          selected={selected}
          onSelect={(id, on) =>
            setSelected((s) => {
              const n = new Set(s);
              if (on) n.add(id);
              else n.delete(id);
              return n;
            })
          }
          onSelectAll={(on) => setSelected(on ? new Set(enabled.map((c) => c.testCase.id)) : new Set())}
          onOpen={(c) => setDrawer({ open: true, testCase: c })}
          onToggle={(id, v) => void toggle.run(id, v)}
          toggling={toggle.pending}
        />
      )}
      <InlineError error={toggle.error} />

      <CaseDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, testCase: null })}
        testCase={drawer.testCase}
        canEdit={canEdit}
        boardName={suite.name}
        onSave={async (input) => {
          if (drawer.testCase) await updateCase(store, me, drawer.testCase.id, input);
          else await createCase(store, me, suite.id, input);
          await data.reload();
        }}
        onDelete={
          drawer.testCase && canEdit
            ? async () => {
                await deleteCase(store, me, drawer.testCase!.id);
                await data.reload();
              }
            : undefined
        }
      />
      <SuiteDialog
        open={editing}
        onClose={() => setEditing(false)}
        suite={suite}
        onSave={async (input) => {
          await updateSuite(store, me, suite.id, input);
          await data.reload();
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this suite?"
        body={<p className="m-0">“{suite.name}” and its {plural(cases.length, 'case')} are deleted. Run history is kept but no longer listed.</p>}
        confirmLabel="Delete suite"
        danger
        onConfirm={async () => {
          await deleteSuite(store, me, suite.id);
          navigate('/');
        }}
      />
    </>
  );
}

function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton width={180} height={14} />
      <Skeleton width={280} height={28} className="mt-3" />
      <Skeleton width={420} height={14} className="mt-3" />
      <Skeleton height={380} className="mt-5 rounded-xl" />
      <Skeleton height={36} width={320} className="mt-5" />
      <Skeleton height={240} className="mt-4 rounded-xl" />
    </div>
  );
}

function CasesTable({
  board,
  canEdit,
  selected,
  onSelect,
  onSelectAll,
  onOpen,
  onToggle,
  toggling,
}: {
  board: Board;
  canEdit: boolean;
  selected: Set<string>;
  onSelect: (id: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onOpen: (c: TestCase) => void;
  onToggle: (id: string, enabled: boolean) => void;
  toggling: boolean;
}) {
  const rows = board.probes;
  const enabledIds = rows.filter((r) => r.testCase.enabled).map((r) => r.testCase.id);
  const allOn = enabledIds.length > 0 && enabledIds.every((id) => selected.has(id));
  return (
    <TableWrap label="Test cases">
      <table className="x-table" data-testid="cases-table">
        <thead>
          <tr>
            <th scope="col" className="w-8">
              <input
                type="checkbox"
                aria-label="Select all enabled cases"
                className="size-4 accent-[var(--accent-9)]"
                checked={allOn}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            <th scope="col">Probe</th>
            <th scope="col">Chip</th>
            <th scope="col">Kind</th>
            <th scope="col" className="num">
              Expected
            </th>
            <th scope="col">Last status</th>
            <th scope="col" className="num">
              Last actual
            </th>
            <th scope="col" className="num">
              Duration
            </th>
            <th scope="col">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const c = p.testCase;
            const s = probeState(p);
            return (
              <tr key={c.id} data-testid="case-row" className={c.enabled ? undefined : 'opacity-70'}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${c.name}`}
                    className="size-4 accent-[var(--accent-9)]"
                    disabled={!c.enabled}
                    checked={selected.has(c.id)}
                    onChange={(e) => onSelect(c.id, e.target.checked)}
                  />
                </td>
                <td className="min-w-[220px]">
                  <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-left font-medium text-fg hover:text-accent-11 hover:underline" onClick={() => onOpen(c)}>
                    {c.name}
                  </button>
                  {c.tags && <div className="mt-0.5 text-xs text-muted">{c.tags}</div>}
                </td>
                <td className="whitespace-nowrap font-mono text-ui text-muted">{p.chip.label}</td>
                <td className="whitespace-nowrap text-muted">{KIND_INFO[c.kind].label}</td>
                <td className="num max-w-[180px] break-words">
                  {c.kind === 'notblank' ? <span className="text-muted">a value</span> : c.expected}
                  {c.tolerance && <div className="text-xs text-muted">± {c.tolerance}</div>}
                </td>
                <td>
                  <Badge tone={TONE[s]}>{c.enabled && !p.last ? 'Not run' : STATE_LABEL[s] === 'Unpowered' ? 'Disabled' : STATE_LABEL[s]}</Badge>
                </td>
                <td className={cx('num max-w-[200px] break-words', s === 'fail' && 'text-bad-text')}>
                  {p.last?.actual != null ? p.last.actual : <span className="text-muted">—</span>}
                  {p.gap && <div className="text-xs">{p.gap.text}</div>}
                </td>
                <td className="num text-muted">{p.last ? formatMs(p.last.durationMs) : '—'}</td>
                <td>
                  <Switch checked={c.enabled} disabled={!canEdit || toggling} label={`Enabled: ${c.name}`} onChange={(v) => onToggle(c.id, v)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

