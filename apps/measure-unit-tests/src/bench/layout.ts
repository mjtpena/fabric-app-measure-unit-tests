/**
 * Geometry of the bench, in world units (1 unit = 1 CSS px at zoom 1). Boards are laid out as a grid of chip cells;
 * each chip has its probes stacked to its right. Traces: an edge connector feeds a spine, the spine feeds one rail
 * above every row of chips, a drop runs from the rail into each chip, and a short trace runs from a chip pin to each
 * probe pad. Pure functions so the layout can be tested and reused by the bench, the board page and the run page.
 */
import type { Board } from './model';

export const G = {
  chipW: 140,
  chipH: 60,
  probePitch: 48,
  padDx: 56,
  labelDx: 18,
  labelW: 236,
  railGap: 44,
  colGap: 30,
  left: 100,
  right: 30,
  header: 66,
  footer: 44,
  boardGap: 72,
} as const;

export const CELL_W = G.chipW + G.padDx + G.labelDx + G.labelW;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProbeBox {
  caseId: string;
  /** Pad centre. */
  x: number;
  y: number;
  labelX: number;
  /** Trace from the chip pin to the pad. */
  trace: string;
  /** Full current path: connector → spine → rail → drop → chip pin → pad. */
  route: string;
}

export interface ChipBox extends Rect {
  key: string;
  row: number;
  col: number;
  cell: Rect;
  dropX: number;
  railY: number;
  probes: ProbeBox[];
}

export interface BoardLayout extends Rect {
  suiteId: string;
  cols: number;
  chips: ChipBox[];
  /** The empty socket that adds a case (owner view), or the "no probes" well on an empty board. */
  socket: (Rect & { dropX: number; railY: number }) | null;
  spineX: number;
  feedY: number;
  connector: Rect;
  rails: { y: number; x1: number; x2: number }[];
}

export interface BenchLayout {
  boards: BoardLayout[];
  bounds: Rect;
  chipCols: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A 45° chamfered trace from a chip pin to a probe pad. */
function probeTrace(x0: number, y0: number, x1: number, y1: number): string {
  const dy = y1 - y0;
  const a = x0 + 14;
  if (Math.abs(dy) < 0.5) return `M${r1(x0)} ${r1(y0)}H${r1(x1)}`;
  const s = Math.sign(dy);
  const c = Math.min(Math.abs(dy) / 2, 12);
  return `M${r1(x0)} ${r1(y0)}H${r1(a)}L${r1(a + c)} ${r1(y0 + s * c)}V${r1(y1 - s * c)}L${r1(a + 2 * c)} ${r1(y1)}H${r1(x1)}`;
}

/** Lay out one board at (x, y) with up to `cols` chip columns. */
export function layoutBoard(board: Pick<Board, 'suite' | 'chips'>, cols: number, opts: { socket: boolean; x?: number; y?: number }): BoardLayout {
  const x0 = opts.x ?? 0;
  const y0 = opts.y ?? 0;
  const cells = board.chips.length + (opts.socket || board.chips.length === 0 ? 1 : 0);
  const c = Math.max(1, Math.min(cols, cells));
  const rows = Math.ceil(cells / c);
  const blockH = (i: number) => (i < board.chips.length ? Math.max(G.chipH, board.chips[i].probes.length * G.probePitch) : G.chipH);
  const rowH: number[] = [];
  for (let r = 0; r < rows; r++) {
    let h = 0;
    for (let k = r * c; k < Math.min(cells, (r + 1) * c); k++) h = Math.max(h, blockH(k));
    rowH.push(h);
  }
  const width = G.left + c * CELL_W + (c - 1) * G.colGap + G.right;
  const height = G.header + rowH.reduce((s, h) => s + h + G.railGap, 0) + G.footer;
  const spineX = x0 + 66;
  const connector: Rect = { x: x0 + 14, y: y0 + G.header + 6, w: 18, h: height - G.header - G.footer - 12 };
  const feedY = connector.y + connector.h / 2;
  const connRight = connector.x + connector.w;

  const chips: ChipBox[] = [];
  let socket: BoardLayout['socket'] = null;
  const rails: BoardLayout['rails'] = [];
  let top = y0 + G.header;
  for (let r = 0; r < rows; r++) {
    const railY = top + G.railGap / 2;
    const cellTop = top + G.railGap;
    let lastDrop = spineX;
    for (let col = 0; col < c; col++) {
      const k = r * c + col;
      if (k >= cells) break;
      const cellX = x0 + G.left + col * (CELL_W + G.colGap);
      const bh = blockH(k);
      if (k >= board.chips.length) {
        socket = { x: cellX, y: cellTop, w: G.chipW, h: G.chipH, dropX: cellX + 26, railY };
        lastDrop = Math.max(lastDrop, cellX + 26);
        continue;
      }
      const chip = board.chips[k];
      const n = chip.probes.length;
      const probesH = n * G.probePitch;
      const chipY = cellTop + (bh - G.chipH) / 2;
      const dropX = cellX + 26;
      lastDrop = Math.max(lastDrop, dropX);
      const chipRight = cellX + G.chipW;
      const padX = chipRight + G.padDx;
      const head = `M${r1(connRight)} ${r1(feedY)}H${r1(spineX)}V${r1(railY)}H${r1(dropX)}V${r1(chipY)}`;
      const probes: ProbeBox[] = chip.probes.map((p, i) => {
        const py = cellTop + (bh - probesH) / 2 + G.probePitch * (i + 0.5);
        const pinY = chipY + (G.chipH * (i + 1)) / (n + 1);
        const trace = probeTrace(chipRight, pinY, padX - 9, py);
        return { caseId: p.testCase.id, x: padX, y: py, labelX: padX + G.labelDx, trace, route: `${head}${trace}` };
      });
      chips.push({
        key: chip.key,
        row: r,
        col,
        x: cellX,
        y: chipY,
        w: G.chipW,
        h: G.chipH,
        cell: { x: cellX - 8, y: cellTop - 8, w: CELL_W + 16, h: bh + 16 },
        dropX,
        railY,
        probes,
      });
    }
    rails.push({ y: railY, x1: spineX, x2: lastDrop });
    top += G.railGap + rowH[r];
  }
  return { suiteId: board.suite.id, cols: c, x: x0, y: y0, w: width, h: height, chips, socket, spineX, feedY, connector, rails };
}

/** Lay out every board in a grid of `boardCols` columns with `chipCols` chip columns each. */
export function layoutBench(boards: Pick<Board, 'suite' | 'chips'>[], chipCols: number, boardCols: number, socketFor: (suiteId: string) => boolean): BenchLayout {
  const first = boards.map((b) => layoutBoard(b, chipCols, { socket: socketFor(b.suite.id) }));
  const bc = Math.max(1, Math.min(boardCols, boards.length));
  const colW: number[] = Array(bc).fill(0);
  const rowH: number[] = [];
  first.forEach((l, i) => {
    colW[i % bc] = Math.max(colW[i % bc], l.w);
    const r = Math.floor(i / bc);
    rowH[r] = Math.max(rowH[r] ?? 0, l.h);
  });
  const placed = boards.map((b, i) => {
    const col = i % bc;
    const row = Math.floor(i / bc);
    const x = colW.slice(0, col).reduce((s, w) => s + w + G.boardGap, 0);
    const y = rowH.slice(0, row).reduce((s, h) => s + h + G.boardGap, 0);
    return layoutBoard(b, chipCols, { socket: socketFor(b.suite.id), x, y });
  });
  const w = colW.reduce((s, x) => s + x, 0) + (bc - 1) * G.boardGap;
  const h = rowH.reduce((s, x) => s + x, 0) + (rowH.length - 1) * G.boardGap;
  return { boards: placed, bounds: { x: 0, y: 0, w: Math.max(w, 1), h: Math.max(h, 1) }, chipCols };
}

/** Scale at which `rect` fits in a viewport with the given insets. */
export function fitScale(rect: Pick<Rect, 'w' | 'h'>, vw: number, vh: number, inset: Insets): number {
  const aw = Math.max(40, vw - inset.left - inset.right);
  const ah = Math.max(40, vh - inset.top - inset.bottom);
  return Math.min(aw / rect.w, ah / rect.h);
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The bench layout that shows every board the largest in this viewport. */
export function bestBenchLayout(boards: Pick<Board, 'suite' | 'chips'>[], vw: number, vh: number, inset: Insets, socketFor: (suiteId: string) => boolean): BenchLayout {
  let best: { layout: BenchLayout; scale: number } | null = null;
  const maxBoardCols = Math.min(3, Math.max(1, boards.length));
  for (let chipCols = 1; chipCols <= 3; chipCols++) {
    for (let bc = 1; bc <= maxBoardCols; bc++) {
      const layout = layoutBench(boards, chipCols, bc, socketFor);
      const scale = fitScale(layout.bounds, vw, vh, inset);
      if (!best || scale > best.scale * 1.03) best = { layout, scale };
    }
  }
  return best!.layout;
}

export type ViewBox = [number, number, number, number];

/** The viewBox that shows `rect` fitted inside the insets of a vw × vh viewport (capped at `maxScale`). */
export function fitViewBox(rect: Rect, vw: number, vh: number, inset: Insets, maxScale = 1.6): ViewBox {
  const s = Math.min(maxScale, fitScale(rect, vw, vh, inset));
  const aw = vw - inset.left - inset.right;
  const ah = vh - inset.top - inset.bottom;
  const x = rect.x - (inset.left + (aw - rect.w * s) / 2) / s;
  const y = rect.y - (inset.top + (ah - rect.h * s) / 2) / s;
  return [x, y, vw / s, vh / s];
}

/** World rect of a chip cell (chip, traces, probes and labels). */
export function chipRect(chip: ChipBox): Rect {
  return chip.cell;
}

export function findProbe(layout: BenchLayout, caseId: string): { board: BoardLayout; chip: ChipBox; probe: ProbeBox } | null {
  for (const board of layout.boards)
    for (const chip of board.chips) {
      const probe = chip.probes.find((p) => p.caseId === caseId);
      if (probe) return { board, chip, probe };
    }
  return null;
}
