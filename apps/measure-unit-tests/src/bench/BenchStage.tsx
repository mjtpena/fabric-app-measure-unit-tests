/**
 * The bench centrepiece: every suite as a circuit board under one camera. The camera fits the whole bench, flies to a
 * board or a chip when something is focused, and can be dragged (mouse) and zoomed (wheel) by hand.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { BoardDefs, BoardG, type BoardIds } from './Board';
import { useCamera, useFontsReady, useSize } from './hooks';
import { bestBenchLayout, findProbe, fitScale, fitViewBox, type BenchLayout, type Insets, type Rect, type ViewBox } from './layout';
import type { LensKey } from './lenses';
import type { LiveView } from './live';
import { durationRange, type BenchData } from './model';

export type Focus = { type: 'board'; suiteId: string } | { type: 'probe'; suiteId: string; caseId: string };

export interface BenchStageProps {
  bench: BenchData;
  lens: LensKey;
  live: LiveView | null;
  focus: Focus | null;
  canEdit: (suiteId: string) => boolean;
  tagFor: (suiteId: string) => string | null;
  modelLabel: string;
  reduced: boolean;
  desktop: boolean;
  justAdded?: string | null;
  /** Extra room on the right when a readout panel is open (desktop). */
  rightPanel?: boolean;
  /** The title panel carries a row of board actions (taller). */
  titleActions?: boolean;
  onProbe: (caseId: string, suiteId: string) => void;
  onBoard: (suiteId: string) => void;
  onRun: (suiteId: string) => void;
  onSocket: (suiteId: string) => void;
  onClear: () => void;
  /** Panels drawn over the stage. */
  overlay?: ReactNode;
}

/** Phones: the stage's top-right corner holds the Today button (top 12px, 44px tall), so the board starts below it. */
const MOBILE_TOP = 66;

const expand = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

export function BenchStage(props: BenchStageProps) {
  const { bench, lens, live, focus, desktop, reduced } = props;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids: BoardIds = { glow: `glow-${uid}`, shadow: `shadow-${uid}`, grad: `grad-${uid}` };
  const [ref, size] = useSize<SVGSVGElement>();
  const fonts = useFontsReady();

  const top = props.titleActions ? 156 : 112;
  const inset: Insets = useMemo(
    () => (desktop ? { top, right: props.rightPanel ? 344 : 28, bottom: 124, left: 28 } : { top: props.rightPanel ? 140 : MOBILE_TOP, right: 12, bottom: 14, left: 12 }),
    [desktop, props.rightPanel, top],
  );
  const baseInset: Insets = useMemo(() => (desktop ? { top, right: 28, bottom: 124, left: 28 } : { top: MOBILE_TOP, right: 12, bottom: 14, left: 12 }), [desktop, top]);

  const layout: BenchLayout | null = useMemo(() => {
    if (!size.w || !size.h) return null;
    return bestBenchLayout(bench.boards, size.w, size.h, baseInset, props.canEdit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bench, size.w, size.h, baseInset, props.canEdit, fonts]);

  const target: ViewBox | null = useMemo(() => {
    if (!layout || !size.w) return null;
    if (focus?.type === 'probe') {
      const hit = findProbe(layout, focus.caseId);
      if (hit) return fitViewBox(expand(hit.chip.cell, desktop ? 64 : 14), size.w, size.h, inset, desktop ? 1.3 : 1.2);
    }
    if (focus) {
      const b = layout.boards.find((x) => x.suiteId === focus.suiteId);
      if (b) return fitViewBox(b, size.w, size.h, inset, 1.25);
    }
    return fitViewBox(layout.bounds, size.w, size.h, inset, 1.25);
  }, [layout, focus, size.w, size.h, inset, desktop]);

  const [vb, setVb] = useCamera(target, reduced);

  // Hand controls: wheel zoom around the pointer, drag to pan (mouse only, so touch still scrolls the page).
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !desktop) return;
    const onWheel = (e: WheelEvent) => {
      if (!vbRef.current || !layoutRef.current) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const [x, y, w, h] = vbRef.current;
      const fit = fitScale(layoutRef.current.bounds, r.width, r.height, baseInset);
      const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0016)));
      const scale = Math.min(3, Math.max(fit * 0.6, r.width / (w * f)));
      const nw = r.width / scale;
      const nh = (h / w) * nw;
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      setVb([x + px * w - px * nw, y + py * h - py * nh, nw, nh]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, desktop, setVb, baseInset]);
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const probeCount = bench.probes.length;
  const range = useMemo(() => durationRange(bench.probes), [bench]);
  return (
    <div className="absolute inset-0">
      <svg
        ref={ref}
        className={`absolute inset-y-0 left-0 h-full select-none ${desktop ? 'bench-grab w-[calc(100%-var(--side-w,0px))]' : 'w-full'} ${dragging ? 'is-dragging' : ''}`}
        viewBox={vb ? vb.join(' ') : undefined}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`Test bench: ${bench.boards.length} ${bench.boards.length === 1 ? 'board' : 'boards'}, ${probeCount} ${probeCount === 1 ? 'probe' : 'probes'}`}
        data-testid="bench-stage"
        data-renderer="svg"
        data-lens={lens}
        data-focus={focus ? (focus.type === 'probe' ? focus.caseId : focus.suiteId) : undefined}
        onPointerDown={(e) => {
          if (!desktop || e.pointerType !== 'mouse' || e.button !== 0 || !vb) return;
          drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 5) return;
          if (!d.moved) {
            d.moved = true;
            setDragging(true);
            ref.current.setPointerCapture(e.pointerId);
          }
          const r = ref.current.getBoundingClientRect();
          const k = d.vb[2] / r.width;
          setVb([d.vb[0] - dx * k, d.vb[1] - dy * k, d.vb[2], d.vb[3]]);
        }}
        onPointerUp={(e) => {
          if (drag.current?.moved) {
            suppressClick.current = true;
            ref.current?.releasePointerCapture(e.pointerId);
          }
          drag.current = null;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClear();
        }}
      >
        <BoardDefs ids={ids} />
        {layout &&
          layout.boards.map((bl) => {
            const board = bench.boards.find((b) => b.suite.id === bl.suiteId)!;
            const editable = props.canEdit(board.suite.id);
            const focusedHere = focus?.suiteId === board.suite.id;
            return (
              <BoardG
                key={bl.suiteId}
                board={board}
                layout={bl}
                lens={lens}
                range={range}
                ids={ids}
                modelLabel={props.modelLabel}
                live={live}
                focusId={focus?.type === 'probe' ? focus.caseId : null}
                focused={focus?.type === 'board' && focusedHere && bench.boards.length > 1}
                dim={!!focus && !focusedHere && bench.boards.length > 1}
                tag={props.tagFor(board.suite.id)}
                reduced={reduced}
                justAdded={props.justAdded}
                boardHref={`#/suites/${board.suite.id}`}
                onProbe={(caseId) => props.onProbe(caseId, board.suite.id)}
                onBoard={props.onBoard}
                onRun={props.onRun}
                onSocket={editable ? props.onSocket : undefined}
              />
            );
          })}
      </svg>
      {props.overlay}
    </div>
  );
}
