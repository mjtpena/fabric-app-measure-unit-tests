/**
 * A single board in its own SVG, sized to its container's width (board and run pages). Decorative for assistive
 * tech: the table below it on those pages carries the same data.
 */
import { useId, useMemo } from 'react';

import { useReducedMotion } from '@x10/shared/ui';

import type { TestResult } from '../model';
import { BoardDefs, BoardG, type BoardIds } from './Board';
import { useFontsReady, useSize } from './hooks';
import { layoutBoard, type BoardLayout } from './layout';
import type { LensKey } from './lenses';
import type { LiveView } from './live';
import type { Board } from './model';

const PAD = 18;

export function BoardView({
  board,
  modelLabel,
  lens = 'status',
  live,
  only,
  focusId,
  maxHeight = 520,
  onProbe,
  label,
  className,
}: {
  board: Board;
  modelLabel: string;
  lens?: LensKey;
  live?: LiveView | null;
  only?: Map<string, TestResult> | null;
  focusId?: string | null;
  maxHeight?: number;
  onProbe?: (caseId: string) => void;
  /** Accessible summary of the picture. */
  label: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids: BoardIds = { glow: `glow-${uid}`, shadow: `shadow-${uid}`, grad: `grad-${uid}` };
  const [ref, size] = useSize<HTMLDivElement>();
  const reduced = useReducedMotion();
  const fonts = useFontsReady();

  const fit = useMemo(() => {
    const avail = Math.max(240, size.w - 2 * PAD);
    let best: { layout: BoardLayout; scale: number } | null = null;
    for (let cols = 1; cols <= 3; cols++) {
      const layout = layoutBoard(board, cols, { socket: false });
      const scale = Math.min(1.1, avail / layout.w, (maxHeight - 2 * PAD) / layout.h);
      if (!best || scale > best.scale * 1.03) best = { layout, scale };
    }
    return best!;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, size.w, maxHeight, fonts]);

  const { layout, scale } = fit;
  const height = Math.round(layout.h * scale + 2 * PAD);
  const vw = size.w / scale;
  const vh = height / scale;
  const vb = `${layout.x - (vw - layout.w) / 2} ${layout.y - (vh - layout.h) / 2} ${vw || layout.w} ${vh}`;

  return (
    <div ref={ref} className={`bench-surface relative overflow-hidden rounded-xl border border-line ${className ?? ''}`} style={{ height }} data-testid="board-view">
      {size.w > 0 && (
        <svg className="absolute inset-0 h-full w-full" viewBox={vb} role="img" aria-label={label}>
          <BoardDefs ids={ids} />
          <BoardG board={board} layout={layout} lens={lens} ids={ids} modelLabel={modelLabel} live={live} only={only} focusId={focusId} decorative reduced={reduced} onProbe={onProbe} />
        </svg>
      )}
    </div>
  );
}
