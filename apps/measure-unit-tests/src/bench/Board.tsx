/**
 * One suite drawn as a circuit board (an SVG <g>): edge connector to the model, spine and rails, a chip per measure
 * and a probe per case. Used by the bench (many boards under one camera), the board page and the run page.
 */
import { memo, type KeyboardEvent, type ReactNode } from 'react';

import { formatRelative } from '@x10/shared/lib';

import type { TestResult } from '../model';
import type { BoardLayout, ChipBox, ProbeBox } from './layout';
import { G } from './layout';
import { KIND_SHAPE, probePaint, probeReadout, STATE_LABEL, type LensKey } from './lenses';
import { withLive, type LivePhase, type LiveView } from './live';
import { durationRange, gapFor, probeState, type Board as BoardData, type DurationRange, type Probe, type ProbeState } from './model';
import { fitText } from './text';

export interface BoardIds {
  glow: string;
  shadow: string;
  grad: string;
}

/** Shared <defs> for every board in one <svg>. */
export function BoardDefs({ ids }: { ids: BoardIds }) {
  return (
    <defs>
      <filter id={ids.glow} x="-150%" y="-150%" width="400%" height="400%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <filter id={ids.shadow} x="-10%" y="-10%" width="125%" height="135%">
        <feGaussianBlur stdDeviation="14" />
      </filter>
      <linearGradient id={ids.grad} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="var(--pcb-board-2)" />
        <stop offset="0.55" stopColor="var(--pcb-board)" />
        <stop offset="1" stopColor="var(--pcb-board)" />
      </linearGradient>
    </defs>
  );
}

export interface BoardProps {
  board: BoardData;
  layout: BoardLayout;
  lens: LensKey;
  ids: BoardIds;
  modelLabel: string;
  live?: LiveView | null;
  /** Run page: show these results only; probes without one are drawn as not part of the run. */
  only?: Map<string, TestResult> | null;
  focusId?: string | null;
  focused?: boolean;
  dim?: boolean;
  /** Duration lens scale (fastest and slowest on the bench). */
  range?: DurationRange;
  /** Silkscreen tag in the header ("READ ONLY", "RUN ONLY"). */
  tag?: string | null;
  /** aria-hidden, no keyboard stops (pages where a table is the accessible equivalent). */
  decorative?: boolean;
  reduced?: boolean;
  justAdded?: string | null;
  boardHref?: string;
  onProbe?: (caseId: string) => void;
  onBoard?: (suiteId: string) => void;
  onRun?: (suiteId: string) => void;
  onSocket?: (suiteId: string) => void;
}

const CUT = 18;

function boardPath(x: number, y: number, w: number, h: number) {
  return `M${x + CUT} ${y}H${x + w - CUT}L${x + w} ${y + CUT}V${y + h - CUT}L${x + w - CUT} ${y + h}H${x + CUT}L${x} ${y + h - CUT}V${y + CUT}Z`;
}

const keyActivate = (fn?: () => void) => (e: KeyboardEvent) => {
  if (!fn) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    fn();
  }
};

const RANK: Record<ProbeState, number> = { fail: 4, error: 3, pass: 2, idle: 1, off: 0 };

interface Shown {
  probe: Probe;
  phase: LivePhase | 'absent';
}

function shown(p: Probe, live: LiveView | null | undefined, only: Map<string, TestResult> | null | undefined): Shown {
  const l = withLive(p, live ?? null);
  if (l.phase) return l;
  if (only) {
    const r = only.get(p.testCase.id);
    if (!r) return { probe: { ...p, last: null, gap: null }, phase: p.testCase.enabled ? 'absent' : null };
    return { probe: { ...p, last: r, gap: r.status === 'fail' ? gapFor(p.testCase.kind, r.expected ?? p.testCase.expected, r.actual) : null }, phase: null };
  }
  return { probe: p, phase: null };
}

export const BoardG = memo(function BoardG(props: BoardProps) {
  const { board, layout: L, lens, ids, live, only, focusId, focused, dim, tag, decorative, reduced, justAdded, modelLabel } = props;
  const { x, y, w, h } = L;
  const running = !!live && live.running && live.suiteId === board.suite.id;
  const interactive = !decorative;
  const probes = new Map(board.probes.map((p) => [p.testCase.id, shown(p, live, only)]));
  const tab = interactive ? 0 : -1;
  const range = props.range ?? durationRange(board.probes);

  // Header summary.
  let summary: string;
  if (running) summary = `RUNNING ${live!.arrived.size}/${live!.order.length}`;
  else if (board.lastRun) {
    const r = board.lastRun;
    const total = r.passCount + r.failCount + r.errorCount;
    summary = `${r.passCount}/${total} PASS · ${formatRelative(r.startedAt).toUpperCase()}`;
  } else summary = board.probes.length ? 'NEVER RUN' : 'NO PROBES';

  const spineTop = Math.min(L.feedY, L.rails[0]?.y ?? L.feedY);
  const spineBottom = Math.max(L.feedY, L.rails[L.rails.length - 1]?.y ?? L.feedY);
  const traceColor = running ? 'var(--pcb-trace-hi)' : 'var(--pcb-trace)';
  const fingers = Math.max(3, Math.floor((L.connector.h + 6) / 15));
  const runW = 74;

  return (
    <g
      data-testid="board"
      data-suite-id={board.suite.id}
      data-running={running || undefined}
      style={{ opacity: dim ? 0.38 : 1, transition: reduced ? undefined : 'opacity 240ms' }}
      aria-hidden={decorative || undefined}
    >
      {/* shadow and body; a powered board glows at its edge */}
      <path d={boardPath(x + 10, y + 22, w - 20, h - 10)} fill="var(--pcb-shadow)" filter={`url(#${ids.shadow})`} />
      {running && <path d={boardPath(x - 3, y - 3, w + 6, h + 6)} fill="none" stroke="var(--pcb-current)" strokeWidth={6} opacity={0.5} filter={`url(#${ids.glow})`} className={reduced ? undefined : 'pcb-breathe'} />}
      <path
        d={boardPath(x, y, w, h)}
        fill={`url(#${ids.grad})`}
        stroke={focused ? 'var(--pcb-current)' : 'var(--pcb-edge)'}
        strokeWidth={focused ? 2.5 : 1.5}
        onClick={interactive && props.onBoard ? () => props.onBoard!(board.suite.id) : undefined}
        style={interactive && props.onBoard ? { cursor: 'pointer' } : undefined}
      />
      <path d={boardPath(x + 7, y + 7, w - 14, h - 14)} fill="none" stroke="var(--pcb-silk)" strokeOpacity={0.09} strokeWidth={1} pointerEvents="none" />
      {[
        [x + 20, y + 20],
        [x + w - 20, y + 20],
        [x + 20, y + h - 20],
        [x + w - 20, y + h - 20],
      ].map(([cx, cy], i) => (
        <g key={i} pointerEvents="none">
          <circle cx={cx} cy={cy} r={8} fill="var(--pcb-copper-dim)" />
          <circle cx={cx} cy={cy} r={4.5} fill="var(--world-sky)" />
        </g>
      ))}

      {/* header silkscreen */}
      <g pointerEvents={interactive ? undefined : 'none'}>
        {props.boardHref && interactive ? (
          <a href={props.boardHref} aria-label={board.suite.name}>
            <text x={x + G.left} y={y + 34} className="font-mono" fontSize={15} fontWeight={600} letterSpacing="0.12em" fill="var(--pcb-silk)" style={{ textDecoration: 'none' }}>
              {fitText(board.suite.name.toUpperCase(), w - G.left - runW - 220, 15, { mono: true, weight: 600, tracking: 0.12 })}
            </text>
          </a>
        ) : (
          <text x={x + G.left} y={y + 34} className="font-mono" fontSize={15} fontWeight={600} letterSpacing="0.12em" fill="var(--pcb-silk)">
            {fitText(board.suite.name.toUpperCase(), w - G.left - runW - 220, 15, { mono: true, weight: 600, tracking: 0.12 })}
          </text>
        )}
        <text x={x + G.left} y={y + 52} className="font-mono" fontSize={10.5} letterSpacing="0.08em" fill="var(--pcb-silk-muted)">
          {`${board.probes.length} ${board.probes.length === 1 ? 'PROBE' : 'PROBES'} · ${board.chips.length} ${board.chips.length === 1 ? 'CHIP' : 'CHIPS'} · REV ${board.runs.length}`}
          {tag ? ` · ${tag}` : ''}
        </text>
        <text
          x={x + w - G.right - (props.onRun && interactive ? runW + 14 : 0)}
          y={y + 38}
          textAnchor="end"
          className="font-mono"
          fontSize={11}
          letterSpacing="0.08em"
          fill={running ? 'var(--pcb-current)' : 'var(--pcb-silk-muted)'}
          data-testid="board-summary"
        >
          {summary}
        </text>
        {/* power LED */}
        <circle cx={x + G.left - 18} cy={y + 29} r={4} fill={running ? 'var(--pcb-current)' : 'var(--pcb-dead)'} />
        {running && <circle cx={x + G.left - 18} cy={y + 29} r={9} fill="var(--pcb-current)" opacity={0.45} filter={`url(#${ids.glow})`} className="pcb-breathe" />}
      </g>
      {props.onRun && interactive && (
        <g
          role="button"
          tabIndex={tab}
          aria-label={`Run ${board.suite.name}`}
          aria-disabled={running || !board.probes.some((p) => p.testCase.enabled) || undefined}
          className="pcb-hit"
          onClick={(e) => {
            e.stopPropagation();
            props.onRun!(board.suite.id);
          }}
          onKeyDown={keyActivate(() => props.onRun!(board.suite.id))}
          data-testid="board-run"
        >
          <rect x={x + w - G.right - runW} y={y + 20} width={runW} height={26} rx={13} fill={running ? 'var(--pcb-current)' : 'transparent'} fillOpacity={running ? 0.18 : 1} stroke="var(--pcb-copper)" strokeWidth={1.5} />
          <rect className="pcb-focus" x={x + w - G.right - runW - 4} y={y + 16} width={runW + 8} height={34} rx={17} fill="none" stroke="var(--pcb-silk)" strokeOpacity={0.5} strokeWidth={1.5} />
          <path d={`M${x + w - G.right - runW + 16} ${y + 27.5}l9 5.5-9 5.5z`} fill="var(--pcb-copper)" />
          <text x={x + w - G.right - runW + 32} y={y + 37} className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.1em" fill="var(--pcb-copper)">
            {running ? 'LIVE' : 'RUN'}
          </text>
        </g>
      )}

      {/* footer silkscreen */}
      <text x={x + G.left} y={y + h - 18} className="font-mono" fontSize={10} letterSpacing="0.1em" fill="var(--pcb-silk-muted)" pointerEvents="none">
        {fitText(`MODEL · ${modelLabel.toUpperCase()}`, (w - G.left - G.right) * 0.62, 10, { mono: true, tracking: 0.1 })}
      </text>
      <text x={x + w - G.right} y={y + h - 18} textAnchor="end" className="font-mono" fontSize={10} letterSpacing="0.1em" fill="var(--pcb-silk-muted)" pointerEvents="none">
        {fitText(`OWNER ${board.suite.createdByName.toUpperCase()}`, (w - G.left - G.right) * 0.34, 10, { mono: true, tracking: 0.1 })}
      </text>

      {/* edge connector to the model */}
      <g pointerEvents="none">
        {Array.from({ length: fingers }, (_, i) => (
          <rect key={i} x={L.connector.x - 14} y={L.connector.y + i * 15} width={L.connector.w + 8} height={9} rx={1.5} fill="var(--pcb-copper)" opacity={running ? 1 : 0.85} />
        ))}
        <text
          x={L.connector.x + L.connector.w + 13}
          y={L.connector.y + 4}
          transform={`rotate(-90 ${L.connector.x + L.connector.w + 13} ${L.connector.y + 4})`}
          textAnchor="end"
          className="font-mono"
          fontSize={9.5}
          letterSpacing="0.16em"
          fill="var(--pcb-silk-muted)"
        >
          MODEL IN
        </text>
      </g>

      {/* traces */}
      <g fill="none" stroke={traceColor} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
        <path d={`M${L.connector.x + L.connector.w} ${L.feedY}H${L.spineX}`} strokeWidth={4} />
        <path d={`M${L.spineX} ${spineTop}V${spineBottom}`} strokeWidth={4} />
        {L.rails.map((r, i) => (
          <path key={i} d={`M${r.x1} ${r.y}H${r.x2}`} strokeWidth={3} />
        ))}
        {L.chips.map((c) => (
          <path key={c.key} d={`M${c.dropX} ${c.railY}V${c.y}`} strokeWidth={2.5} />
        ))}
        {L.socket && <path d={`M${L.socket.dropX} ${L.socket.railY}V${L.socket.y}`} strokeWidth={2} strokeDasharray="4 5" />}
        {L.chips.flatMap((c) => c.probes.map((p) => <path key={p.caseId} d={p.trace} strokeWidth={2} />))}
      </g>
      <g pointerEvents="none">
        {L.rails.map((r, i) => (
          <circle key={i} cx={L.spineX} cy={r.y} r={4.5} fill="var(--pcb-board)" stroke="var(--pcb-copper-dim)" strokeWidth={2} />
        ))}
        {L.chips.map((c) => (
          <circle key={c.key} cx={c.dropX} cy={c.railY} r={3.5} fill="var(--pcb-board)" stroke="var(--pcb-copper-dim)" strokeWidth={2} />
        ))}
      </g>

      {/* current flowing to probes whose query is in flight */}
      {running && (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
          {L.chips.flatMap((c) =>
            c.probes
              .filter((p) => probes.get(p.caseId)?.phase === 'flowing')
              .map((p) => (
                <g key={p.caseId}>
                  <path d={p.route} stroke="var(--pcb-current)" strokeOpacity={0.28} strokeWidth={8} />
                  <path d={p.route} stroke="var(--pcb-current)" strokeWidth={2.5} className={reduced ? undefined : 'pcb-flow'} data-testid="current" />
                  {!reduced &&
                    [0, 0.45].map((delay) => (
                      <g key={delay}>
                        <circle r={9} fill="var(--pcb-current)" opacity={0.45} filter={`url(#${ids.glow})`}>
                          <animateMotion dur="0.9s" begin={`${delay}s`} repeatCount="indefinite" path={p.route} rotate="auto" />
                        </circle>
                        <circle r={3.5} fill="var(--pcb-silk)">
                          <animateMotion dur="0.9s" begin={`${delay}s`} repeatCount="indefinite" path={p.route} rotate="auto" />
                        </circle>
                      </g>
                    ))}
                </g>
              )),
          )}
        </g>
      )}

      {/* chips */}
      {L.chips.map((c) => {
        const chip = board.chips.find((k) => k.key === c.key);
        if (!chip) return null;
        const worst = chip.probes.map((p) => probeState(probes.get(p.testCase.id)?.probe ?? p)).sort((a, b) => RANK[b] - RANK[a])[0];
        return <ChipG key={c.key} box={c} label={chip.label} kind={chip.kind} led={lens === 'status' ? worst : null} />;
      })}

      {/* socket: add a case */}
      {L.socket && (
        <Socket
          rect={L.socket}
          empty={board.chips.length === 0}
          canAdd={!!props.onSocket && interactive}
          label={board.chips.length === 0 && !props.onSocket ? 'NO PROBES YET' : '+ ADD CASE'}
          onClick={props.onSocket ? () => props.onSocket!(board.suite.id) : undefined}
          suiteName={board.suite.name}
        />
      )}

      {/* probes */}
      {L.chips.flatMap((c) =>
        c.probes.map((box) => {
          const s = probes.get(box.caseId);
          if (!s) return null;
          return (
            <ProbeG
              key={box.caseId}
              box={box}
              shown={s}
              lens={lens}
              range={range}
              ids={ids}
              focused={focusId === box.caseId}
              interactive={interactive}
              reduced={!!reduced}
              runId={live?.runId}
              justAdded={justAdded === box.caseId}
              onClick={props.onProbe ? () => props.onProbe!(box.caseId) : undefined}
            />
          );
        }),
      )}
    </g>
  );
});

function ChipG({ box, label, kind, led }: { box: ChipBox; label: string; kind: string; led: ProbeState | null }) {
  const { x, y, w, h } = box;
  const pins = box.probes.length;
  return (
    <g pointerEvents="none">
      <rect x={x + 3} y={y + 5} width={w} height={h} rx={5} fill="var(--pcb-shadow)" opacity={0.7} />
      <rect x={x} y={y} width={w} height={h} rx={5} fill="var(--pcb-chip)" />
      <rect x={x + 3} y={y + 3} width={w - 6} height={h - 9} rx={3.5} fill="var(--pcb-chip-top)" opacity={0.55} />
      {/* input pin from the rail */}
      <rect x={box.dropX - 4} y={y - 5} width={8} height={6} rx={1} fill="var(--pcb-pin)" />
      {/* one output pin per probe */}
      {Array.from({ length: pins }, (_, i) => {
        const py = y + (h * (i + 1)) / (pins + 1);
        return <rect key={i} x={x + w - 1} y={py - 2.5} width={7} height={5} rx={1} fill="var(--pcb-pin)" />;
      })}
      <circle cx={x + 10} cy={y + 10} r={2.5} fill="var(--pcb-chip-ink)" opacity={0.45} />
      {led && <circle cx={x + w - 11} cy={y + 11} r={3.5} fill={led === 'idle' || led === 'off' ? 'var(--pcb-dead)' : `var(--${led === 'pass' ? 'ok' : led === 'fail' ? 'bad' : 'warn'}-solid)`} />}
      <text x={x + w / 2} y={y + h / 2 + 2} textAnchor="middle" className="font-mono" fontSize={12.5} fontWeight={600} fill="var(--pcb-chip-ink)">
        {fitText(label, w - 22, 12.5, { mono: true, weight: 600 })}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 17} textAnchor="middle" className="font-mono" fontSize={8.5} letterSpacing="0.16em" fill="var(--pcb-chip-ink)" opacity={0.55}>
        {kind === 'measure' ? 'MEASURE' : kind === 'table' ? 'TABLE' : 'QUERY'}
      </text>
    </g>
  );
}

function Socket({
  rect,
  empty,
  canAdd,
  label,
  onClick,
  suiteName,
}: {
  rect: { x: number; y: number; w: number; h: number };
  empty: boolean;
  canAdd: boolean;
  label: string;
  onClick?: () => void;
  suiteName: string;
}) {
  const body = (
    <>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={5} fill="var(--pcb-silk)" fillOpacity={0.04} stroke="var(--pcb-silk-muted)" strokeDasharray="5 4" strokeWidth={1.25} />
      <rect className="pcb-focus" x={rect.x - 4} y={rect.y - 4} width={rect.w + 8} height={rect.h + 8} rx={8} fill="none" stroke="var(--pcb-silk)" strokeOpacity={0.6} strokeWidth={1.5} />
      <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 4} textAnchor="middle" className="font-mono" fontSize={11} letterSpacing="0.12em" fill="var(--pcb-silk-muted)">
        {label}
      </text>
      {empty && (
        <text x={rect.x + rect.w + 18} y={rect.y + rect.h / 2 + 4} className="font-mono" fontSize={10.5} letterSpacing="0.06em" fill="var(--pcb-silk-muted)" opacity={0.8}>
          {canAdd ? 'A CASE IS A PROBE ON A MEASURE' : 'THE OWNER ADDS PROBES'}
        </text>
      )}
    </>
  );
  if (!canAdd || !onClick) return <g pointerEvents="none">{body}</g>;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Add a case to ${suiteName}`}
      className="pcb-hit"
      data-testid="board-socket"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={keyActivate(onClick)}
    >
      {body}
    </g>
  );
}

function PadShape({ shape, x, y, scale = 1, fill, className, stroke, strokeWidth }: { shape: 'dot' | 'line' | 'square' | 'diamond'; x: number; y: number; scale?: number; fill: string; className?: string; stroke?: string; strokeWidth?: number }) {
  const common = { fill, className, stroke, strokeWidth };
  if (shape === 'dot') return <circle cx={x} cy={y} r={8 * scale} {...common} />;
  if (shape === 'line') return <rect x={x - 13 * scale} y={y - 7 * scale} width={26 * scale} height={14 * scale} rx={7 * scale} {...common} />;
  if (shape === 'square') return <rect x={x - 8 * scale} y={y - 8 * scale} width={16 * scale} height={16 * scale} rx={3 * scale} {...common} />;
  const d = 10 * scale;
  return <path d={`M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z`} {...common} />;
}

function ProbeG({
  box,
  shown: s,
  lens,
  range,
  ids,
  focused,
  interactive,
  reduced,
  runId,
  justAdded,
  onClick,
}: {
  box: ProbeBox;
  shown: Shown;
  lens: LensKey;
  range: DurationRange;
  ids: BoardIds;
  focused: boolean;
  interactive: boolean;
  reduced: boolean;
  runId?: string;
  justAdded: boolean;
  onClick?: () => void;
}) {
  const p = s.probe;
  const state = probeState(p);
  const absent = s.phase === 'absent';
  const live = s.phase === 'queued' || s.phase === 'flowing';
  const paint = live ? { color: s.phase === 'flowing' ? 'var(--pcb-current)' : 'var(--pcb-idle)', lit: s.phase === 'flowing' } : probePaint(p, lens, range);
  const shape = KIND_SHAPE[p.testCase.kind];
  const readout = absent ? 'not in this run' : s.phase === 'queued' ? 'queued' : s.phase === 'flowing' ? 'measuring…' : probeReadout(p, lens);
  const name = fitText(p.testCase.name, G.labelW, 13, { weight: 500 });
  const readText = fitText(readout, G.labelW, 11.5, { mono: true });
  const ink =
    absent || live
      ? 'var(--pcb-silk-muted)'
      : lens === 'status' && state === 'fail'
        ? 'var(--pcb-bad-ink)'
        : lens === 'status' && state === 'error'
          ? 'var(--pcb-warn-ink)'
          : 'var(--pcb-silk-muted)';
  const label = `${p.testCase.name}. ${live ? (s.phase === 'flowing' ? 'Measuring' : 'Queued') : absent ? 'Not in this run' : STATE_LABEL[state]}. ${readout}`;
  const attention = !live && !absent && lens === 'status' && (state === 'fail' || state === 'error');
  const body: ReactNode = (
    <>
      {/* hit area */}
      <rect x={box.x - 18} y={box.y - 22} width={G.labelDx + G.labelW + 24} height={44} fill="transparent" />
      {/* glow */}
      {paint.lit && !absent && (
        <circle
          cx={box.x}
          cy={box.y}
          r={lens === 'status' || live ? 17 : 13}
          fill={paint.color}
          opacity={live ? 0.55 : 0.5}
          filter={`url(#${ids.glow})`}
          className={reduced ? undefined : attention ? 'pcb-breathe' : live ? 'pcb-charge' : undefined}
        />
      )}
      {/* copper pad, then the LED */}
      <PadShape shape={shape} x={box.x} y={box.y} scale={1.38} fill={absent ? 'var(--pcb-copper-dim)' : 'var(--pcb-copper)'} />
      <PadShape
        shape={shape}
        x={box.x}
        y={box.y}
        fill={absent ? 'var(--pcb-dead)' : paint.color}
        className={s.phase === 'queued' && !reduced ? 'pcb-charge' : justAdded && !reduced ? 'pcb-solder' : undefined}
      />
      {paint.lit && !absent && <circle cx={box.x - 2.5} cy={box.y - 2.5} r={2.2} fill="var(--pcb-silk)" opacity={0.55} />}
      {s.phase === 'arrived' && !reduced && (
        <circle key={`${runId}-${box.caseId}`} cx={box.x} cy={box.y} r={8} fill="none" stroke={paint.color} strokeWidth={2} className="pcb-arrive" />
      )}
      {focused && <circle cx={box.x} cy={box.y} r={21} fill="none" stroke="var(--pcb-current)" strokeWidth={2} strokeDasharray="4 4" />}
      <circle className="pcb-focus" cx={box.x} cy={box.y} r={17} fill="none" stroke="var(--pcb-silk)" strokeOpacity={0.55} strokeWidth={1.5} />
      <text x={box.labelX} y={box.y - 3} fontSize={13} fontWeight={500} fill="var(--pcb-silk)" opacity={absent ? 0.5 : 1}>
        {name}
      </text>
      <text x={box.labelX} y={box.y + 14} className="font-mono" fontSize={11.5} fill={ink} opacity={absent ? 0.6 : 1}>
        {readText}
      </text>
    </>
  );
  const common = {
    'data-testid': 'probe',
    'data-case-id': box.caseId,
    'data-state': live ? s.phase! : absent ? 'absent' : state,
    'data-focused': focused || undefined,
  };
  if (!interactive || !onClick)
    return (
      <g {...common} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
        {body}
      </g>
    );
  return (
    <g
      {...common}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={focused}
      className="pcb-hit"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={keyActivate(onClick)}
    >
      {body}
    </g>
  );
}
