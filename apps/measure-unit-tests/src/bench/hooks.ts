import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { ViewBox } from './layout';
import { resetTextCache } from './text';

/** Element size, kept current with a ResizeObserver. */
export function useSize<T extends Element>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * A camera over the world: animates the SVG viewBox to `target` whenever it changes (a short flight with zoom in log
 * space), or jumps when motion is reduced. `set` moves it immediately (drag and wheel).
 */
export function useCamera(target: ViewBox | null, reduced: boolean, duration = 720): [ViewBox | null, (v: ViewBox) => void] {
  const [vb, setVb] = useState<ViewBox | null>(target);
  const cur = useRef<ViewBox | null>(target);
  const key = target ? target.map((n) => Math.round(n * 10)).join(',') : '';
  useEffect(() => {
    if (!target) return;
    const from = cur.current;
    if (!from || reduced) {
      cur.current = target;
      setVb(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const lw0 = Math.log(from[2]);
    const lw1 = Math.log(target[2]);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = ease(k);
      const w = Math.exp(lw0 + (lw1 - lw0) * e);
      const ratio = target[3] / target[2];
      // Interpolate the centre, so the zoom stays anchored on the subject.
      const cx = from[0] + from[2] / 2 + (target[0] + target[2] / 2 - (from[0] + from[2] / 2)) * e;
      const cy = from[1] + from[3] / 2 + (target[1] + target[3] / 2 - (from[1] + from[3] / 2)) * e;
      const hgt = w * ratio;
      const v: ViewBox = [cx - w / 2, cy - hgt / 2, w, hgt];
      cur.current = v;
      setVb(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);
  const set = useCallback((v: ViewBox) => {
    cur.current = v;
    setVb(v);
  }, []);
  return [vb, set];
}

/** Re-render once the web fonts are ready, so label widths are measured with the real font. */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => typeof document === 'undefined' || !('fonts' in document) || document.fonts.status === 'loaded');
  useEffect(() => {
    if (ready || typeof document === 'undefined' || !('fonts' in document)) return;
    let on = true;
    void document.fonts.ready.then(() => {
      if (!on) return;
      resetTextCache();
      setReady(true);
    });
    return () => {
      on = false;
    };
  }, [ready]);
  return ready;
}
