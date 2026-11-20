/**
 * Home: the test bench. Every suite is a circuit board, every measure a chip, every case a probe. Lenses re-paint the
 * probes, Today flies to what needs attention, and Run sends current along the traces as results stream in.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Activity, CircuitBoard, Keyboard, List, PenLine, Play, Plus, RotateCcw, SquareArrowOutUpRight } from 'lucide-react';

import { describeError, useAsync } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import {
  Button,
  IconButton,
  Legend,
  LensBar,
  LinkButton,
  Spinner,
  StageMessage,
  StagePage,
  StatusDot,
  Toast,
  TodayPanel,
  Tooltip,
  useHotkeys,
  useIsDesktop,
  useReducedMotion,
  ViewAsSwitch,
  ViewToggle,
  type StageView,
  type TodayItem,
} from '@x10/shared/ui';

import { BenchList } from '../bench/BenchList';
import { BenchStage, type Focus } from '../bench/BenchStage';
import { LENSES, legendFor, type LensKey } from '../bench/lenses';
import { liveView, withLive } from '../bench/live';
import { loadBench } from '../bench/load';
import { stateCounts, todayEntries, type Board } from '../bench/model';
import { CompactReadout, ProbeReadout, RunMonitor } from '../bench/panels';
import { CaseDrawer } from '../components/CaseDrawer';
import { Shortcuts } from '../components/Shortcuts';
import { SuiteDialog } from '../components/SuiteDialog';
import { createCase, deleteCase, updateCase } from '../domain/cases';
import { canEditSuite, createSuite } from '../domain/suites';
import type { Schema, TestCase } from '../model';
import { useModelClient } from '../model-client';
import { useRuns } from '../run-context';

type ViewAs = 'owner' | 'developer';

const BENCH_BG =
  'radial-gradient(circle at 1px 1px, var(--bench-dots) 1px, transparent 1.5px) 0 0 / 22px 22px, radial-gradient(120% 90% at 40% 30%, var(--world-sky-2) 0%, var(--world-sky) 70%)';

const SHORTCUTS = [
  { keys: ['1', '2', '3', '4'], label: 'Lens: status, duration, flakiness, kind' },
  { keys: ['R'], label: 'Run the focused board' },
  { keys: ['A'], label: 'Add a case to the focused board' },
  { keys: ['O'], label: 'Oscilloscope for the focused board' },
  { keys: ['N'], label: 'New suite' },
  { keys: ['V'], label: 'Switch view as' },
  { keys: ['L'], label: 'Bench or list' },
  { keys: ['F'], label: 'Fit the whole bench' },
  { keys: ['Esc'], label: 'Clear focus' },
  { keys: ['?'], label: 'This list' },
];

export function BenchPage() {
  const app = useApp<Schema>();
  const { store, me } = app;
  const client = useModelClient();
  const runs = useRuns();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const desktop = useIsDesktop();
  const reduced = useReducedMotion();
  const data = useAsync(() => loadBench(store), [store]);
  const bench = data.data;

  const [lens, setLens] = useState<LensKey>('status');
  const [view, setView] = useState<StageView>('stage');
  const [viewAsChoice, setViewAs] = useState<ViewAs | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [drawer, setDrawer] = useState<{ suiteId: string; testCase: TestCase | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // A finished run changes every probe it touched: read the bench again.
  const finished = runs.active?.done ? runs.active.run.id : null;
  useEffect(() => {
    if (finished) void data.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // Deep links from other screens: ?probe=<case id> or ?board=<suite id>.
  const deepProbe = params.get('probe');
  const deepBoard = params.get('board');
  useEffect(() => {
    if (!bench) return;
    if (deepProbe) {
      const p = bench.probes.find((x) => x.testCase.id === deepProbe);
      if (p) setFocus({ type: 'probe', caseId: p.testCase.id, suiteId: p.suiteId });
    } else if (deepBoard && bench.boards.some((b) => b.suite.id === deepBoard)) setFocus({ type: 'board', suiteId: deepBoard });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!bench, deepProbe, deepBoard]);

  const canEditAny = !!bench?.boards.some((b) => canEditSuite(me, b.suite));
  const viewAs: ViewAs = viewAsChoice ?? (canEditAny || !bench?.boards.length ? 'owner' : 'developer');
  const suiteOf = (id: string) => bench?.boards.find((b) => b.suite.id === id)?.suite;
  const canEdit = useMemo(
    () => (suiteId: string) => {
      const s = bench?.boards.find((b) => b.suite.id === suiteId)?.suite;
      return !!s && viewAs === 'owner' && canEditSuite(me, s);
    },
    [bench, viewAs, me],
  );
  const tagFor = useMemo(
    () => (suiteId: string) => {
      const s = bench?.boards.find((b) => b.suite.id === suiteId)?.suite;
      if (!s) return null;
      if (viewAs === 'developer') return 'RUN ONLY';
      return canEditSuite(me, s) ? null : 'READ ONLY';
    },
    [bench, viewAs, me],
  );

  const live = liveView(runs.active);
  const board: Board | null = bench
    ? (bench.boards.find((b) => b.suite.id === focus?.suiteId) ?? (bench.boards.length === 1 ? bench.boards[0] : null))
    : null;
  const probe = focus?.type === 'probe' ? (bench?.probes.find((p) => p.testCase.id === focus.caseId) ?? null) : null;
  const liveProbe = probe ? withLive(probe, live).probe : null;

  const today = useMemo(() => (bench ? todayEntries(bench) : []), [bench]);
  const todayItems: TodayItem[] = today.map((t) => ({
    id: t.id,
    title: t.title,
    severity: t.severity,
    value: t.value,
    unit: t.unit,
    lens: LENSES.find((l) => l.value === t.lens)?.label,
    meta: suiteOf(t.suiteId)?.name,
  }));
  const activeToday = today.find((t) => (focus?.type === 'probe' ? t.caseId === focus.caseId : t.caseId === null && t.suiteId === focus?.suiteId))?.id ?? null;

  const clear = () => setFocus(null);
  const focusProbe = (caseId: string, suiteId: string) =>
    setFocus((f) => (f?.type === 'probe' && f.caseId === caseId ? { type: 'board', suiteId } : { type: 'probe', caseId, suiteId }));
  const focusBoard = (suiteId: string) => setFocus((f) => (f?.type === 'board' && f.suiteId === suiteId ? null : { type: 'board', suiteId }));
  const runBoard = async (suiteId: string) => {
    if (runs.busy) return;
    setFocus((f) => (f?.suiteId === suiteId ? f : { type: 'board', suiteId }));
    setView('stage');
    try {
      await runs.start(suiteId);
    } catch (e) {
      setToast(describeError(e).message);
    }
  };
  const openNew = (suiteId: string) => setDrawer({ suiteId, testCase: null });
  const openProbe = (caseId: string) => {
    const p = bench?.probes.find((x) => x.testCase.id === caseId);
    if (p) setDrawer({ suiteId: p.suiteId, testCase: p.testCase });
  };

  useHotkeys(
    {
      r: () => board && void runBoard(board.suite.id),
      a: () => board && canEdit(board.suite.id) && openNew(board.suite.id),
      o: () => board && navigate(`/suites/${board.suite.id}/history`),
      n: () => setCreating(true),
      f: clear,
      escape: () => {
        if (focus) clear();
        else if (runs.active?.done) runs.dismiss();
      },
      'shift+?': () => setHelp(true),
    },
    { enabled: !drawer && !creating },
  );

  const counts = board ? stateCounts(board.probes) : bench ? stateCounts(bench.probes) : null;
  const runningHere = !!board && !!runs.active && !runs.active.done && runs.active.run.suiteId === board.suite.id;
  const monitorSuite = runs.active ? suiteOf(runs.active.run.suiteId) : undefined;
  const monitor =
    runs.active && monitorSuite ? (
      <RunMonitor active={runs.active} suiteName={monitorSuite.name} onCancel={runs.cancel} onDismiss={runs.dismiss} />
    ) : null;
  const readout = liveProbe ? (
    <ProbeReadout
      probe={liveProbe}
      suiteName={suiteOf(liveProbe.suiteId)?.name ?? ''}
      canEdit={canEdit(liveProbe.suiteId)}
      onOpen={() => openProbe(liveProbe.testCase.id)}
      onClose={() => setFocus({ type: 'board', suiteId: liveProbe.suiteId })}
    />
  ) : null;

  const meta = !bench ? (
    <span>Reading the bench…</span>
  ) : board ? (
    <>
      {counts && (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 num">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone="ok" />
            {counts.pass} pass
          </span>
          {counts.fail > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone="bad" />
              {counts.fail} fail
            </span>
          )}
          {counts.error > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone="warn" />
              {counts.error} error
            </span>
          )}
          {counts.off > 0 && <span>{counts.off} off</span>}
        </span>
      )}
      <span>owner {board.suite.createdByName}</span>
      <span className="flex basis-full flex-wrap gap-2 pt-2">
        <Button size="sm" variant="primary" icon={<Play />} busy={runningHere} disabled={runs.busy || !board.probes.some((p) => p.testCase.enabled)} onClick={() => void runBoard(board.suite.id)}>
          Run suite
        </Button>
        {canEdit(board.suite.id) && (
          <Button size="sm" icon={<Plus />} onClick={() => openNew(board.suite.id)}>
            Add case
          </Button>
        )}
        <LinkButton size="sm" variant="ghost" to={`/suites/${board.suite.id}/history`} icon={<Activity />}>
          Oscilloscope
        </LinkButton>
        <OpenBoardLink to={`/suites/${board.suite.id}`} />
      </span>
    </>
  ) : (
    <span className="num">
      {bench.boards.length} boards · {bench.probes.length} probes · {client.label}
    </span>
  );

  const stage = !bench ? (
    data.error ? (
      <StageMessage
        icon={<CircuitBoard />}
        title="The bench did not load"
        action={
          <Button icon={<RotateCcw />} onClick={() => void data.reload()}>
            Retry
          </Button>
        }
      >
        {data.error.message}
      </StageMessage>
    ) : (
      <StageMessage icon={<Spinner small />} title="Laying out the bench" />
    )
  ) : bench.boards.length === 0 ? (
    <StageMessage
      icon={<CircuitBoard />}
      title="No boards on the bench yet"
      action={
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
          New suite
        </Button>
      }
    >
      A suite becomes a board; each case you add is a probe on the measure it checks.
    </StageMessage>
  ) : (
    <BenchStage
      bench={bench}
      lens={lens}
      live={live}
      focus={focus}
      canEdit={canEdit}
      tagFor={tagFor}
      modelLabel={client.label}
      reduced={reduced}
      desktop={desktop}
      justAdded={justAdded}
      rightPanel={!!readout}
      titleActions={!!board}
      onProbe={focusProbe}
      onBoard={focusBoard}
      onRun={(id) => void runBoard(id)}
      onSocket={openNew}
      onClear={clear}
      overlay={
        !desktop ? (
          liveProbe ? (
            <div className="absolute inset-x-3 top-[66px]">
              <CompactReadout
                probe={liveProbe}
                canEdit={canEdit(liveProbe.suiteId)}
                onOpen={() => openProbe(liveProbe.testCase.id)}
                onClose={() => setFocus({ type: 'board', suiteId: liveProbe.suiteId })}
              />
            </div>
          ) : null
        ) : monitor || readout ? (
          <div className="pointer-events-none absolute top-16 flex w-[316px] flex-col gap-3 [&>*]:pointer-events-auto" style={{ right: 'calc(16px + var(--side-w, 0px))' }}>
            {monitor}
            {readout}
          </div>
        ) : null
      }
    />
  );

  const drawerSuite = drawer ? suiteOf(drawer.suiteId) : undefined;

  return (
    <>
      <StagePage
        label="Test bench"
        view={view}
        background={BENCH_BG}
        breadcrumb={[
          { label: 'Bench', onClick: clear },
          ...(board ? [{ label: board.suite.name, onClick: () => setFocus({ type: 'board', suiteId: board.suite.id }) }] : [{ label: 'All boards' }]),
          ...(probe ? [{ label: probe.chip.label }] : []),
        ]}
        title={board ? board.suite.name : 'Test bench'}
        meta={meta}
        topRight={
          <>
            <Button className={view === 'stage' ? 'x-glass rounded-full! ring-0' : undefined} icon={<Plus />} onClick={() => setCreating(true)}>
              New suite
            </Button>
            <ViewToggle value={view} onChange={setView} glass={view === 'stage'} stageLabel="Bench" stageIcon={<CircuitBoard />} listIcon={<List />} />
            {desktop && <IconButton label="Keyboard shortcuts" icon={<Keyboard />} className={view === 'stage' ? 'x-glass rounded-full! ring-0' : undefined} onClick={() => setHelp(true)} />}
          </>
        }
        lenses={<LensBar lenses={LENSES} value={lens} onChange={setLens} />}
        legend={bench && bench.probes.length > 0 ? <Legend title={LENSES.find((l) => l.value === lens)?.label} items={legendFor(lens, bench.probes)} collapsible defaultOpen={desktop} /> : undefined}
        bottomRight={
          <ViewAsSwitch<ViewAs>
            value={viewAs}
            onChange={setViewAs}
            options={[
              { value: 'owner', label: 'Owner', icon: <PenLine /> },
              { value: 'developer', label: 'Developer', icon: <Play /> },
            ]}
          />
        }
        side={
          <TodayPanel
            bare
            items={todayItems}
            date={new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            activeId={activeToday}
            empty={bench && !bench.probes.length ? 'Nothing on the bench yet.' : 'Every probe passed its last run.'}
            onSelect={(item) => {
              const t = today.find((x) => x.id === item.id);
              if (!t) return;
              setLens(t.lens);
              setView('stage');
              setFocus(t.caseId ? { type: 'probe', caseId: t.caseId, suiteId: t.suiteId } : { type: 'board', suiteId: t.suiteId });
            }}
          />
        }
        sideCount={today.length}
        stage={stage}
        list={bench ? <BenchList bench={bench} focusId={probe?.testCase.id} onOpen={(caseId) => openProbe(caseId)} /> : null}
      >
        {!desktop && view === 'stage' && (monitor || readout) ? (
          <div className="flex flex-col gap-3">
            {monitor}
            {readout}
          </div>
        ) : null}
      </StagePage>

      <SuiteDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSave={async (input) => {
          const s = await createSuite(store, me, input);
          await data.reload();
          navigate(`/suites/${s.id}`);
        }}
      />
      <CaseDrawer
        open={!!drawer}
        onClose={() => setDrawer(null)}
        testCase={drawer?.testCase ?? null}
        canEdit={!!drawer && canEdit(drawer.suiteId)}
        boardName={drawerSuite?.name}
        onSave={async (input) => {
          if (!drawer) return;
          if (drawer.testCase) await updateCase(store, me, drawer.testCase.id, input);
          else {
            const created = await createCase(store, me, drawer.suiteId, input);
            setJustAdded(created.id);
            setFocus({ type: 'probe', caseId: created.id, suiteId: drawer.suiteId });
          }
          await data.reload();
        }}
        onDelete={
          drawer?.testCase && canEdit(drawer.suiteId)
            ? async () => {
                await deleteCase(store, me, drawer.testCase!.id);
                setFocus({ type: 'board', suiteId: drawer.suiteId });
                await data.reload();
              }
            : undefined
        }
      />
      <Shortcuts open={help} onClose={() => setHelp(false)} items={SHORTCUTS} />
      {toast && <Toast message={toast} tone="bad" onDone={() => setToast(null)} />}
    </>
  );
}

function OpenBoardLink({ to }: { to: string }) {
  return (
    <Tooltip content="Open board">
      <LinkButton size="sm" variant="ghost" to={to} icon={<SquareArrowOutUpRight />} aria-label="Open board" />
    </Tooltip>
  );
}
