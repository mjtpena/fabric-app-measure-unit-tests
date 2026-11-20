/** Lenses: the four ways the bench re-paints its probes, and what each probe's readout line says under each. */
import type { LegendItem, LensOption } from '@x10/shared/ui';

import { KIND_INFO } from '../domain/compare';
import { formatMs } from '../domain/runs';
import type { CaseKind } from '../model';
import { durationRange, durationScale, formatReading, probeState, type DurationRange, type Probe, type ProbeState } from './model';

export type LensKey = 'status' | 'duration' | 'flakiness' | 'kind';

export const LENSES: LensOption<LensKey>[] = [
  { value: 'status', label: 'Status', swatch: 'conic-gradient(var(--ok-solid) 0 50%, var(--bad-solid) 0 75%, var(--warn-solid) 0)', description: 'Last result of each probe' },
  { value: 'duration', label: 'Duration', swatch: 'linear-gradient(90deg, var(--cyan-9), var(--amber-9), var(--ember-9))', description: 'How long each query took' },
  { value: 'flakiness', label: 'Flakiness', swatch: 'linear-gradient(90deg, var(--teal-9), var(--violet-9))', description: 'Pass/fail flips across runs' },
  { value: 'kind', label: 'Kind', swatch: 'conic-gradient(var(--cyan-9) 0 25%, var(--violet-9) 0 50%, var(--gold-9) 0 75%, var(--coral-9) 0)', description: 'Scalar, between, row count, not blank' },
];

export const STATE_COLOR: Record<ProbeState, string> = {
  pass: 'var(--ok-solid)',
  fail: 'var(--bad-solid)',
  error: 'var(--warn-solid)',
  off: 'var(--pcb-dead)',
  idle: 'var(--pcb-idle)',
};

export const STATE_LABEL: Record<ProbeState, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Error',
  off: 'Unpowered',
  idle: 'Not run',
};

export const KIND_COLOR: Record<CaseKind, string> = {
  scalar: 'var(--cyan-9)',
  between: 'var(--violet-9)',
  rowcount: 'var(--gold-9)',
  notblank: 'var(--coral-9)',
};

/** Probe pad shape per kind (always, whatever the lens): a reading, a band, a count, a presence check. */
export const KIND_SHAPE: Record<CaseKind, 'dot' | 'line' | 'square' | 'diamond'> = {
  scalar: 'dot',
  between: 'line',
  rowcount: 'square',
  notblank: 'diamond',
};

function durationColor(ms: number, range?: DurationRange): string {
  const t = durationScale(ms, range);
  return t < 0.5
    ? `color-mix(in oklab, var(--amber-9) ${Math.round(t * 200)}%, var(--cyan-9))`
    : `color-mix(in oklab, var(--ember-9) ${Math.round((t - 0.5) * 200)}%, var(--amber-9))`;
}

function flakeColor(score: number): string {
  return `color-mix(in oklab, var(--violet-9) ${Math.round(Math.min(1, score * 1.6) * 100)}%, var(--teal-9))`;
}

/** The pad colour of a probe under a lens. `lit` is false when the probe has nothing to show (dim pad). */
export function probePaint(p: Probe, lens: LensKey, range?: DurationRange): { color: string; lit: boolean } {
  const state = probeState(p);
  if (lens === 'kind') return { color: KIND_COLOR[p.testCase.kind], lit: state !== 'off' };
  if (state === 'off') return { color: STATE_COLOR.off, lit: false };
  if (lens === 'status') return { color: STATE_COLOR[state], lit: state !== 'idle' };
  if (lens === 'duration') return p.last ? { color: durationColor(p.last.durationMs, range), lit: true } : { color: STATE_COLOR.idle, lit: false };
  return p.flaky === null ? { color: STATE_COLOR.idle, lit: false } : { color: flakeColor(p.flaky), lit: true };
}

/** The second line under a probe's name. */
export function probeReadout(p: Probe, lens: LensKey): string {
  const state = probeState(p);
  if (lens === 'kind') return kindLine(p);
  if (state === 'off') return 'unpowered · disabled';
  if (lens === 'duration') return p.last ? `${formatMs(p.last.durationMs)} last run` : 'not run yet';
  if (lens === 'flakiness') {
    const seen = p.history.filter((h) => h !== null).length;
    if (seen < 2) return seen ? 'one run so far' : 'not run yet';
    return p.flips ? `${p.flips} ${p.flips === 1 ? 'flip' : 'flips'} in ${seen} runs` : `stable over ${seen} runs`;
  }
  if (!p.last) return 'not run yet';
  if (p.last.status === 'fail') return p.gap ? `${p.gap.versus} · ${p.gap.text}` : (p.last.actual ?? 'fail');
  if (p.last.status === 'error') return p.last.message?.includes('cannot be determined') ? 'not found in the model' : 'short circuit';
  if (p.testCase.kind === 'notblank') return `“${p.last.actual ?? ''}”`;
  if (p.testCase.kind === 'rowcount') return `${formatReading(p.last.actual)} rows`;
  return formatReading(p.last.actual);
}

export function kindLine(p: Pick<Probe, 'testCase'>): string {
  const c = p.testCase;
  const label = KIND_INFO[c.kind].label;
  if (c.kind === 'notblank') return label;
  if (c.kind === 'between') return `${label} ${c.expected ?? ''}`;
  if (c.kind === 'rowcount') return `${label} = ${c.expected ?? ''}`;
  return `${label} ${c.expected ?? ''}${c.tolerance ? ` ± ${c.tolerance}` : ''}`;
}

/** Legend rows for a lens, with counts where they help. */
export function legendFor(lens: LensKey, probes: Probe[]): LegendItem[] {
  if (lens === 'status') {
    const n = (s: ProbeState) => probes.filter((p) => probeState(p) === s).length;
    return (['pass', 'fail', 'error', 'off', 'idle'] as ProbeState[])
      .filter((s) => s !== 'idle' || n(s) > 0)
      .map((s) => ({ label: STATE_LABEL[s], color: STATE_COLOR[s], shape: s === 'idle' ? 'ring' : 'dot', value: n(s) }));
  }
  if (lens === 'duration') {
    const r = durationRange(probes);
    const mid = Math.round(Math.sqrt(r.min * r.max));
    return [
      { label: `Fastest ${formatMs(r.min)}`, color: durationColor(r.min, r), shape: 'dot' },
      { label: formatMs(mid), color: durationColor(mid, r), shape: 'dot' },
      { label: `Slowest ${formatMs(r.max)}`, color: durationColor(r.max, r), shape: 'dot' },
    ];
  }
  if (lens === 'flakiness')
    return [
      { label: 'Stable', color: flakeColor(0), shape: 'dot' },
      { label: 'Flips sometimes', color: flakeColor(0.35), shape: 'dot' },
      { label: 'Flips every run', color: flakeColor(1), shape: 'dot' },
      { label: 'Under 2 runs', color: STATE_COLOR.idle, shape: 'ring' },
    ];
  return (Object.keys(KIND_COLOR) as CaseKind[]).map((k) => ({
    label: KIND_INFO[k].label,
    color: KIND_COLOR[k],
    shape: KIND_SHAPE[k] === 'dot' ? 'dot' : KIND_SHAPE[k] === 'square' ? 'square' : KIND_SHAPE[k] === 'diamond' ? 'diamond' : 'line',
    value: probes.filter((p) => p.testCase.kind === k).length,
  }));
}
