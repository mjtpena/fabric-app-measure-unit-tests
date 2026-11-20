/**
 * Comparators: turn one query result plus a case's expected value into pass, fail or error.
 * Pure functions, shared by the run engine and the "Test query" preview.
 *
 * - scalar:   first cell of the first row equals expected. Numbers compare within a tolerance: absolute ("0.01") or
 *             percent of expected ("0.5%"); default 0.000001. Anything that is not a number compares as exact text.
 * - rowcount: number of rows equals expected (an integer).
 * - notblank: first cell is not blank, null or an empty string. Expected holds nothing.
 * - between:  first cell is a number within low..high, inclusive.
 * Numbers may carry thousands separators, currency symbols or a trailing % (divided by 100); they are stripped first.
 * A query that returns zero rows is an error ("no rows") for every kind except rowcount, where 0 is a valid count.
 */
import type { ModelQueryResult } from '@x10/shared/connectors';

import { RUN_RULES } from '../config';
import { limits, type CaseKind, type ResultStatus } from '../model';

export type Tolerance = { kind: 'abs'; value: number } | { kind: 'pct'; value: number };

export interface Verdict {
  status: ResultStatus;
  /** Display text of what the model returned (null when nothing came back). */
  actual: string | null;
  message: string;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const CURRENCY_RE = /[$€£¥₹₩₽¢₱₺₫₪]/g;
const SEPARATORS_RE = /[,\s  _']/g;

/**
 * Read a number from a cell or a typed value. Strips currency symbols and codes, thousands separators (comma, space,
 * underscore, apostrophe) and reads "(1,234)" as negative and "45%" as 0.45. Returns null for anything else.
 */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^[A-Z]{3}\s*(?=[-+\d.$€£¥₹])/, '').replace(/(?<=[\d.])\s*[A-Z]{3}$/, '');
  s = s.replace(CURRENCY_RE, '').replace(SEPARATORS_RE, '');
  let scale = 1;
  if (s.endsWith('%')) {
    scale = 0.01;
    s = s.slice(0, -1);
  }
  if (!NUMBER_RE.test(s)) return null;
  const n = Number(s) * scale;
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Empty tolerance → the default absolute tolerance. "0.5%" → percent. "10" → absolute. Null when unreadable. */
export function parseTolerance(text: string | null | undefined): Tolerance | null {
  const s = (text ?? '').trim();
  if (!s) return { kind: 'abs', value: RUN_RULES.defaultTolerance };
  const pct = /^(.*)%$/.exec(s);
  if (pct) {
    const n = parseNumber(pct[1]);
    return n !== null && n >= 0 ? { kind: 'pct', value: n } : null;
  }
  const n = parseNumber(s);
  return n !== null && n >= 0 ? { kind: 'abs', value: n } : null;
}

export function describeTolerance(t: Tolerance): string {
  return t.kind === 'pct' ? `±${formatNumber(t.value)}%` : `±${formatNumber(t.value)}`;
}

/** True when `actual` is within the tolerance of `expected`. A percent tolerance of 0 falls back to the default. */
export function withinTolerance(actual: number, expected: number, tol: Tolerance): boolean {
  const diff = Math.abs(actual - expected);
  const allowed = tol.kind === 'abs' ? tol.value : (Math.abs(expected) * tol.value) / 100;
  // A tiny epsilon absorbs binary floating-point noise on the boundary.
  return diff <= Math.max(allowed, RUN_RULES.defaultTolerance) + Number.EPSILON * Math.max(1, Math.abs(expected));
}

/** "low..high" → numbers (low ≤ high). Null when it cannot be read. */
export function parseRange(text: string | null | undefined): { low: number; high: number } | null {
  const m = /^(.+?)\.\.(.+)$/.exec((text ?? '').trim());
  if (!m) return null;
  const low = parseNumber(m[1]);
  const high = parseNumber(m[2]);
  if (low === null || high === null || low > high) return null;
  return { low, high };
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Numbers without float noise: 0.1 + 0.2 → "0.3", 1284530.75 → "1284530.75". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/** Display text of a cell. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '(blank)';
  if (typeof v === 'string') return v === '' ? '(empty string)' : v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * "Use this value as expected": the text to put in the Expected field for a test-query answer.
 * Numbers are written plainly (no separators, no float noise); strings are kept as they are; blank gives ''.
 */
export function valueForExpected(kind: CaseKind, result: ModelQueryResult): string | null {
  if (result.status !== 'success') return null;
  if (kind === 'rowcount') return String(result.table.rows.length);
  if (kind === 'notblank' || kind === 'between') return null;
  const v = result.table.rows[0]?.[0];
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return v.trim().slice(0, limits.expected.max);
  return formatValue(v).slice(0, limits.expected.max);
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function verdict(status: ResultStatus, actual: string | null, message: string): Verdict {
  return {
    status,
    actual: actual === null ? null : clip(actual, limits.actual.max),
    message: clip(message, limits.message.max),
  };
}

/** Compare a query result with the expectation. Never throws. */
export function evaluate(
  kind: CaseKind,
  result: ModelQueryResult,
  expected: string | null | undefined,
  tolerance?: string | null,
): Verdict {
  if (result.status !== 'success') {
    return verdict('error', null, `${result.error.category}: ${result.error.message}`);
  }
  const rows = result.table.rows ?? [];
  const exp = (expected ?? '').trim();

  if (kind === 'rowcount') {
    const want = parseNumber(exp);
    if (want === null || !Number.isInteger(want)) return verdict('error', String(rows.length), 'Expected row count is not an integer.');
    return rows.length === want
      ? verdict('pass', String(rows.length), `${rows.length} rows, as expected.`)
      : verdict('fail', String(rows.length), `Expected ${formatNumber(want)} rows, got ${rows.length}.`);
  }

  if (rows.length === 0) return verdict('error', null, 'no rows');
  const first = rows[0]?.[0];
  const actual = formatValue(first);

  if (kind === 'notblank') {
    return isBlank(first) ? verdict('fail', actual, 'The first cell is blank.') : verdict('pass', actual, 'The first cell has a value.');
  }

  if (kind === 'between') {
    const range = parseRange(exp);
    if (!range) return verdict('error', actual, 'Expected range must look like low..high.');
    if (isBlank(first)) return verdict('fail', actual, 'The first cell is blank.');
    const n = parseNumber(first);
    if (n === null) return verdict('fail', actual, 'The first cell is not a number.');
    const inside = n >= range.low && n <= range.high;
    return inside
      ? verdict('pass', actual, `Within ${formatNumber(range.low)}..${formatNumber(range.high)}.`)
      : verdict('fail', actual, `${formatNumber(n)} is ${n < range.low ? 'below' : 'above'} ${formatNumber(range.low)}..${formatNumber(range.high)}.`);
  }

  // scalar
  if (!exp) return verdict('error', actual, 'Expected value is missing.');
  const want = parseNumber(exp);
  if (want !== null) {
    if (isBlank(first)) return verdict('fail', actual, `Expected ${exp}, got a blank.`);
    const got = parseNumber(first);
    if (got === null) return verdict('fail', actual, `Expected a number, got text.`);
    const tol = parseTolerance(tolerance);
    if (!tol) return verdict('error', formatNumber(got), 'Tolerance must be a number or a percent such as 0.5%.');
    if (withinTolerance(got, want, tol)) {
      return verdict('pass', formatNumber(got), got === want ? 'Exact match.' : `Within tolerance (${describeTolerance(tol)}).`);
    }
    const diff = got - want;
    const rel = want !== 0 ? ` (${diff > 0 ? '+' : ''}${formatNumber(Number(((diff / Math.abs(want)) * 100).toFixed(2)))}%)` : '';
    return verdict('fail', formatNumber(got), `Off by ${diff > 0 ? '+' : ''}${formatNumber(diff)}${rel}; tolerance ${describeTolerance(tol)}.`);
  }
  if (isBlank(first)) return verdict('fail', actual, `Expected "${exp}", got a blank.`);
  const text = String(first).trim();
  return text === exp ? verdict('pass', text, 'Exact match.') : verdict('fail', text, `Expected "${exp}".`);
}

/** Form check for Expected and Tolerance per kind. Returns per-field messages. */
export function checkExpectation(
  kind: CaseKind,
  expected: string,
  tolerance: string,
): { expected?: string; tolerance?: string } {
  const out: { expected?: string; tolerance?: string } = {};
  const exp = expected.trim();
  const tol = tolerance.trim();
  if (exp.length > limits.expected.max) out.expected = `Expected must be ${limits.expected.max} characters or fewer.`;
  if (tol.length > limits.tolerance.max) out.tolerance = `Tolerance must be ${limits.tolerance.max} characters or fewer.`;
  if (out.expected || out.tolerance) return out;
  switch (kind) {
    case 'scalar':
      if (!exp) out.expected = 'Expected value is required.';
      if (tol) {
        if (!parseTolerance(tol)) out.tolerance = 'Use a number (absolute) or a percent such as 0.5%.';
        else if (exp && parseNumber(exp) === null) out.tolerance = 'Tolerance applies to numeric expected values only.';
      }
      break;
    case 'rowcount': {
      const n = parseNumber(exp);
      if (!exp) out.expected = 'Expected row count is required.';
      else if (n === null || !Number.isInteger(n) || n < 0) out.expected = 'Expected row count must be a whole number.';
      break;
    }
    case 'between':
      if (!exp) out.expected = 'Expected range is required, for example 0.2..0.6.';
      else if (!parseRange(exp)) out.expected = 'Use low..high with numbers, low first, for example 0.2..0.6.';
      break;
    case 'notblank':
      break;
  }
  return out;
}

/** Short description of what a kind checks, for hints and the About page. */
export const KIND_INFO: Record<CaseKind, { label: string; expectedHint: string; placeholder: string }> = {
  scalar: {
    label: 'Scalar',
    expectedHint: 'A number or text. Numbers may include separators or a currency symbol.',
    placeholder: '34054.7',
  },
  rowcount: { label: 'Row count', expectedHint: 'The number of rows the query returns.', placeholder: '6' },
  notblank: { label: 'Not blank', expectedHint: 'Passes when the first cell has a value. No expected value.', placeholder: '' },
  between: { label: 'Between', expectedHint: 'Inclusive range as low..high, for example 0.2..0.6 or 20%..60%.', placeholder: '0.2..0.6' },
};
