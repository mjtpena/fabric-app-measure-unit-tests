/** Text fitting for labels drawn in the SVG world (SVG text does not wrap or truncate on its own). */

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

function measure(text: string, font: string): number {
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  let w: number;
  if (ctx) {
    ctx.font = font;
    w = ctx.measureText(text).width;
  } else {
    // No canvas (tests): an average glyph width.
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 13);
    w = text.length * size * (font.includes('Mono') ? 0.6 : 0.53);
  }
  if (cache.size > 4000) cache.clear();
  cache.set(key, w);
  return w;
}

export const SANS = `'Geist Variable', ui-sans-serif, system-ui, sans-serif`;
export const MONO = `'Geist Mono Variable', ui-monospace, monospace`;

/** Truncate `text` with an ellipsis so it fits `maxWidth` px in the given font. */
export function fitText(text: string, maxWidth: number, size: number, opts: { mono?: boolean; weight?: number; tracking?: number } = {}): string {
  const font = `${opts.weight ?? 400} ${size}px ${opts.mono ? MONO : SANS}`;
  const track = (opts.tracking ?? 0) * size;
  const width = (s: string) => measure(s, font) + track * s.length;
  if (width(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(`${text.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '…';
}

/** Drop cached widths (after the web fonts finish loading). */
export function resetTextCache() {
  cache.clear();
}
