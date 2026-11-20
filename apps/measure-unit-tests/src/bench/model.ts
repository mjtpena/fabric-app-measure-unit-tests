/**
 * The test bench model: suites become boards, the measure (or table) a case queries becomes a chip, and each case is
 * a probe soldered to its chip. Pure functions over the stored rows; nothing here is invented for decoration.
 */
import type { CaseKind, ResultStatus, TestCase, TestResult, TestRun, TestSuite } from '../model';
import { formatNumber, parseNumber, parseRange } from '../domain/compare';
import { stripLeadingComments } from '../domain/dax';
import { passRate } from '../domain/runs';
import { explainShort } from '../domain/shorts';

/* ------------------------------------------------------------------ chips */

export type ChipKind = 'measure' | 'table' | 'query';

export interface ChipRef {
  /** Stable grouping key, lower case. */
  key: string;
  /** Display label: `[Total Sales]`, `Store`. */
  label: string;
  kind: ChipKind;
}

/**
 * What a case's DAX is about: the first measure it evaluates (`[Total Sales]`), else the first table it reads
 * (`'Store'`, `'Product'[Category]` → Product), else a generic query chip.
 */
export function chipFor(dax: string): ChipRef {
  const s = stripLeadingComments(dax).replace(/"(?:[^"]|"")*"/g, '""');
  // A measure: [Name] not directly preceded by a table name or quote.
  const measure = /(^|[^\w'\]])\[((?:[^\]]|\]\])+)\]/.exec(s);
  if (measure) {
    const name = measure[2].replace(/\]\]/g, ']').trim();
    return { key: `m:${name.toLowerCase()}`, label: `[${name}]`, kind: 'measure' };
  }
  const quoted = /'((?:[^']|'')+)'/.exec(s);
  if (quoted) {
    const name = quoted[1].replace(/''/g, "'").trim();
    return { key: `t:${name.toLowerCase()}`, label: name, kind: 'table' };
  }
  const bare = /\b([A-Za-z_][\w]*)\s*\[/.exec(s.replace(/^\s*(EVALUATE|DEFINE)\b/i, ''));
  if (bare && !/^(ROW|CALCULATE|VALUES|DISTINCT|TOPN|FILTER|SUMMARIZE|COUNTROWS|SELECTCOLUMNS|ADDCOLUMNS)$/i.test(bare[1])) {
    return { key: `t:${bare[1].toLowerCase()}`, label: bare[1], kind: 'table' };
  }
  const table = /^\s*EVALUATE\s+([A-Za-z_][\w]*)\s*$/i.exec(s);
  if (table) return { key: `t:${table[1].toLowerCase()}`, label: table[1], kind: 'table' };
  return { key: 'q:query', label: 'Query', kind: 'query' };
}

/* ------------------------------------------------------------------ history and flakiness */

export type Reading = ResultStatus | null;

/**
 * One case's status per run, oldest run first (null when the case was not part of that run).
 * `runs` may come in any order.
 */
export function caseHistory(caseId: string, runs: Pick<TestRun, 'id' | 'startedAt'>[], results: Pick<TestResult, 'runId' | 'caseId' | 'status' | 'createdAt'>[]): Reading[] {
  const ordered = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const byRun = new Map<string, Reading>();
  for (const r of results) {
    if (r.caseId !== caseId) continue;
    byRun.set(r.runId, r.status);
  }
  return ordered.map((run) => byRun.get(run.id) ?? null);
}

/** Times the case changed between passing and not passing, over the runs it was part of. */
export function countFlips(history: Reading[]): number {
  const seen = history.filter((h): h is ResultStatus => h !== null);
  let flips = 0;
  for (let i = 1; i < seen.length; i++) if ((seen[i] === 'pass') !== (seen[i - 1] === 'pass')) flips++;
  return flips;
}

/** Flakiness 0..1 (flips per possible flip), or null with fewer than two readings. */
export function flakiness(history: Reading[]): number | null {
  const n = history.filter((h) => h !== null).length;
  return n < 2 ? null : countFlips(history) / (n - 1);
}

/* ------------------------------------------------------------------ gap */

export interface Gap {
  /** Short text such as "−8.6%", "+2 rows", "above by 0.04", "blank". */
  text: string;
  /** "13,709 vs 15,000". */
  versus: string;
  /** Relative size for scaling the mark (0..1+). */
  size: number;
}

/** "34,054.7", "0.4031", "13,709". */
export function formatReading(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'number' ? v : parseNumber(v);
  if (n === null) return String(v);
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 4;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

const minus = (s: string) => s.replace(/^-/, '−');

/** How far a failing reading is from what was expected. Null when it cannot be worked out. */
export function gapFor(kind: CaseKind, expected: string | null, actual: string | null): Gap | null {
  if (actual === null) return null;
  if (kind === 'notblank') return { text: 'blank', versus: 'blank', size: 1 };
  const got = parseNumber(actual);
  if (kind === 'between') {
    const range = parseRange(expected);
    if (!range || got === null) return null;
    const below = got < range.low;
    const edge = below ? range.low : range.high;
    const d = got - edge;
    const span = Math.max(Math.abs(range.high - range.low), Number.EPSILON);
    return {
      text: `${below ? 'below' : 'above'} by ${formatReading(Math.abs(d))}`,
      versus: `${formatReading(got)} vs ${formatReading(range.low)}..${formatReading(range.high)}`,
      size: Math.min(1.5, Math.abs(d) / span),
    };
  }
  const want = parseNumber(expected);
  if (got === null || want === null) return expected ? { text: 'mismatch', versus: `${actual} vs ${expected}`, size: 1 } : null;
  const d = got - want;
  if (kind === 'rowcount') {
    return {
      text: minus(`${d > 0 ? '+' : ''}${formatNumber(d)} ${Math.abs(d) === 1 ? 'row' : 'rows'}`),
      versus: `${formatReading(got)} vs ${formatReading(want)} rows`,
      size: Math.min(1.5, want ? Math.abs(d) / Math.abs(want) : 1),
    };
  }
  const rel = want !== 0 ? d / Math.abs(want) : null;
  const text = rel === null ? `${d > 0 ? '+' : ''}${formatReading(d)}` : `${d > 0 ? '+' : ''}${(rel * 100).toFixed(Math.abs(rel) < 0.1 ? 1 : 0)}%`;
  return { text: minus(text), versus: `${formatReading(got)} vs ${formatReading(want)}`, size: Math.min(1.5, Math.abs(rel ?? 1)) };
}

/* ------------------------------------------------------------------ boards */

export interface Probe {
  testCase: TestCase;
  suiteId: string;
  chip: ChipRef;
  last: TestResult | null;
  history: Reading[];
  flips: number;
  flaky: number | null;
  gap: Gap | null;
}

export interface Chip extends ChipRef {
  probes: Probe[];
}

export interface Board {
  suite: TestSuite;
  chips: Chip[];
  probes: Probe[];
  /** Newest first. */
  runs: TestRun[];
  lastRun: TestRun | null;
  lastPassRate: number | null;
}

export interface BenchData {
  boards: Board[];
  /** Every probe on the bench, board order then chip order. */
  probes: Probe[];
}

const byCreated = (a: TestCase, b: TestCase) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name);

/** Build the bench from rows. Suites keep name order; chips keep the order of their first case. */
export function buildBench(suites: TestSuite[], cases: TestCase[], runs: TestRun[], results: TestResult[]): BenchData {
  const boards = [...suites]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((suite) => buildBoard(suite, cases.filter((c) => c.suiteId === suite.id), runs.filter((r) => r.suiteId === suite.id), results.filter((r) => r.suiteId === suite.id)));
  return { boards, probes: boards.flatMap((b) => b.probes) };
}

export function buildBoard(suite: TestSuite, cases: TestCase[], runs: TestRun[], results: TestResult[]): Board {
  const sortedRuns = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const runOrder = new Map(sortedRuns.map((r, i) => [r.id, i]));
  const latest = new Map<string, TestResult>();
  for (const r of results) {
    const prev = latest.get(r.caseId);
    // Newest run wins; within a run the later row.
    const newer =
      !prev ||
      (runOrder.get(r.runId) ?? 1e9) < (runOrder.get(prev.runId) ?? 1e9) ||
      (r.runId === prev.runId && r.createdAt > prev.createdAt) ||
      (!runOrder.has(r.runId) && !runOrder.has(prev.runId) && r.createdAt > prev.createdAt);
    if (newer) latest.set(r.caseId, r);
  }
  const chips: Chip[] = [];
  const probes: Probe[] = [];
  for (const c of [...cases].sort(byCreated)) {
    const ref = chipFor(c.dax);
    const history = caseHistory(c.id, sortedRuns, results);
    const last = latest.get(c.id) ?? null;
    const probe: Probe = {
      testCase: c,
      suiteId: suite.id,
      chip: ref,
      last,
      history,
      flips: countFlips(history),
      flaky: flakiness(history),
      gap: last && last.status === 'fail' ? gapFor(c.kind, last.expected ?? c.expected, last.actual) : null,
    };
    let chip = chips.find((x) => x.key === ref.key);
    if (!chip) {
      chip = { ...ref, probes: [] };
      chips.push(chip);
    }
    chip.probes.push(probe);
  }
  for (const chip of chips) probes.push(...chip.probes);
  const lastRun = sortedRuns[0] ?? null;
  return { suite, chips, probes, runs: sortedRuns, lastRun, lastPassRate: lastRun ? passRate(lastRun) : null };
}

/* ------------------------------------------------------------------ probe state */

export type ProbeState = 'pass' | 'fail' | 'error' | 'off' | 'idle';

/** Status of a probe as the bench shows it: disabled cases are unpowered, never-run cases idle. */
export function probeState(p: Pick<Probe, 'testCase' | 'last'>): ProbeState {
  if (!p.testCase.enabled) return 'off';
  return p.last?.status ?? 'idle';
}

/* ------------------------------------------------------------------ today */

export type TodayKind = 'fail' | 'error' | 'flaky' | 'slow' | 'off' | 'stale';

export interface TodayEntry {
  id: string;
  kind: TodayKind;
  caseId: string | null;
  suiteId: string;
  title: string;
  value: string;
  unit: string;
  lens: 'status' | 'duration' | 'flakiness' | 'kind';
  severity: 'bad' | 'warn' | 'info' | 'neutral';
}

const DAY = 86_400_000;

/**
 * The three to five things on the bench that need attention now, ranked: failing probes (biggest gap first), short
 * circuits, the flakiest probe, the slowest probe, then boards not run for a week and unpowered probes.
 */
export function todayEntries(bench: BenchData, now: Date = new Date(), max = 5): TodayEntry[] {
  const out: TodayEntry[] = [];
  const board = (id: string) => bench.boards.find((b) => b.suite.id === id)?.suite.name ?? '';
  const live = bench.probes.filter((p) => p.testCase.enabled);

  const failing = live.filter((p) => p.last?.status === 'fail').sort((a, b) => (b.gap?.size ?? 0) - (a.gap?.size ?? 0));
  for (const p of failing)
    out.push({
      id: `fail:${p.testCase.id}`,
      kind: 'fail',
      caseId: p.testCase.id,
      suiteId: p.suiteId,
      title: `${p.testCase.name} is failing`,
      value: p.gap?.text.replace(/^(below|above) by /, '') ?? 'fail',
      unit: p.gap ? (p.gap.text.startsWith('below') ? 'below range' : p.gap.text.startsWith('above') ? 'above range' : 'off expected') : board(p.suiteId),
      lens: 'status',
      severity: 'bad',
    });

  for (const p of live.filter((x) => x.last?.status === 'error')) {
    const seen = p.history.filter((h) => h !== null).length;
    const shorted = p.history.filter((h) => h === 'error').length;
    out.push({
      id: `error:${p.testCase.id}`,
      kind: 'error',
      caseId: p.testCase.id,
      suiteId: p.suiteId,
      title: explainShort(p.last?.message).title,
      value: `${shorted}/${seen}`,
      unit: 'runs shorted',
      lens: 'status',
      severity: 'warn',
    });
  }

  const used = () => new Set(out.map((o) => o.caseId));
  const flaky = live.filter((p) => p.flips > 0 && !used().has(p.testCase.id)).sort((a, b) => b.flips - a.flips || (b.flaky ?? 0) - (a.flaky ?? 0))[0];
  if (flaky) {
    const seen = flaky.history.filter((h) => h !== null).length;
    out.push({
      id: `flaky:${flaky.testCase.id}`,
      kind: 'flaky',
      caseId: flaky.testCase.id,
      suiteId: flaky.suiteId,
      title: `${flaky.testCase.name} flipped ${flaky.flips === 1 ? 'once' : `${flaky.flips} times`} in ${seen} runs`,
      value: `${flaky.flips}×`,
      unit: flaky.flips === 1 ? 'flip' : 'flips',
      lens: 'flakiness',
      severity: 'info',
    });
  }

  const taken = used();
  const slow = live.filter((p) => p.last && !taken.has(p.testCase.id)).sort((a, b) => (b.last?.durationMs ?? 0) - (a.last?.durationMs ?? 0))[0];
  if (slow?.last && live.filter((p) => p.last).length > 1)
    out.push({
      id: `slow:${slow.testCase.id}`,
      kind: 'slow',
      caseId: slow.testCase.id,
      suiteId: slow.suiteId,
      title: `Slowest probe: ${slow.testCase.name}`,
      value: slow.last.durationMs >= 1000 ? `${(slow.last.durationMs / 1000).toFixed(1)}` : String(slow.last.durationMs),
      unit: slow.last.durationMs >= 1000 ? 's' : 'ms',
      lens: 'duration',
      severity: 'neutral',
    });

  for (const b of bench.boards) {
    if (!b.probes.length) continue;
    const age = b.lastRun ? (now.getTime() - new Date(b.lastRun.startedAt).getTime()) / DAY : null;
    if (age === null || age >= 7)
      out.push({
        id: `stale:${b.suite.id}`,
        kind: 'stale',
        caseId: null,
        suiteId: b.suite.id,
        title: age === null ? `${b.suite.name} has never been run` : `${b.suite.name} has not run in a week`,
        value: age === null ? 'new' : String(Math.floor(age)),
        unit: age === null ? 'board' : 'days',
        lens: 'status',
        severity: 'warn',
      });
  }

  const off = bench.probes.filter((p) => !p.testCase.enabled);
  if (off.length)
    out.push({
      id: `off:${off[0].testCase.id}`,
      kind: 'off',
      caseId: off[0].testCase.id,
      suiteId: off[0].suiteId,
      title: off.length === 1 ? `Unpowered: ${off[0].testCase.name}` : `${off.length} probes are unpowered`,
      value: String(off.length),
      unit: 'disabled',
      lens: 'status',
      severity: 'neutral',
    });

  return out.slice(0, max);
}

/* ------------------------------------------------------------------ counts */

export function stateCounts(probes: Pick<Probe, 'testCase' | 'last'>[]): Record<ProbeState, number> {
  const out: Record<ProbeState, number> = { pass: 0, fail: 0, error: 0, off: 0, idle: 0 };
  for (const p of probes) out[probeState(p)]++;
  return out;
}

export interface DurationRange {
  min: number;
  max: number;
}

/** Fastest and slowest last reading on the bench (the duration lens is relative to them). */
export function durationRange(probes: Pick<Probe, 'last'>[]): DurationRange {
  const ms = probes.map((p) => p.last?.durationMs).filter((x): x is number => typeof x === 'number' && x >= 0);
  if (!ms.length) return { min: 100, max: 3000 };
  const min = Math.max(1, Math.min(...ms));
  const max = Math.max(...ms);
  return max / min < 1.5 ? { min: min / 1.25, max: max * 1.25 } : { min, max };
}

/** Duration band for the duration lens: 0 (fastest on the bench) .. 1 (slowest), on a log scale. */
export function durationScale(ms: number, range: DurationRange = { min: 100, max: 3000 }): number {
  const lo = Math.log(Math.max(1, range.min));
  const hi = Math.log(Math.max(range.min + 1, range.max));
  return Math.max(0, Math.min(1, (Math.log(Math.max(1, ms)) - lo) / (hi - lo)));
}
