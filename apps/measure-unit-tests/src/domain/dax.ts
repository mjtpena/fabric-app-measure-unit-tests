/**
 * DAX helpers for the Add case helper: Measure-mode query builder, its inverse, and the Raw DAX guard.
 * Pure functions; quoting goes through the shared DAX helpers.
 */
import { daxBracket, daxColumn, daxString } from '@x10/shared/connectors';

import { limits } from '../model';

/** Name of the single column Measure mode returns. */
export const MEASURE_COLUMN = 'v';

export interface MeasureRef {
  /** Table name when the measure was written as 'Table'[Measure] or Table[Measure]. */
  table: string | null;
  measure: string;
}

/**
 * Parse a measure reference as people type it: `[Total Sales]`, `Total Sales`, `'Sales'[Total Sales]` or
 * `Sales[Total Sales]`. Returns null when it is not a single measure reference.
 */
export function parseMeasureRef(input: string): MeasureRef | null {
  const s = input.trim();
  if (!s) return null;
  const m = /^(?:'((?:[^']|'')+)'|([A-Za-z_][\w ]*?))?\s*\[((?:[^\]]|\]\])+)\]$/.exec(s);
  if (m) {
    const table = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2]?.trim() ?? null);
    const measure = m[3].replace(/\]\]/g, ']').trim();
    return measure ? { table: table || null, measure } : null;
  }
  // A bare name: no brackets, quotes or operators.
  if (/^[^[\]'"()=<>+*/,;]+$/.test(s)) return { table: null, measure: s };
  return null;
}

/** `[Total Sales]` or `'Sales'[Total Sales]`, quoted with the shared helpers. */
export function measureExpression(ref: MeasureRef): string {
  return ref.table ? daxColumn(ref.table, ref.measure) : daxBracket(ref.measure);
}

/**
 * Measure mode: `[Total Sales]` + `'Date'[Year] = 2025` →
 * `EVALUATE ROW("v", CALCULATE([Total Sales], 'Date'[Year] = 2025))`. Without a filter the measure is evaluated as is.
 */
export function buildMeasureQuery(measure: string, filter?: string | null): string {
  const ref = parseMeasureRef(measure);
  if (!ref) throw new Error('Enter a measure name such as [Total Sales].');
  const expr = measureExpression(ref);
  const f = (filter ?? '').trim();
  const value = f ? `CALCULATE(${expr}, ${f})` : expr;
  return `EVALUATE ROW(${daxString(MEASURE_COLUMN)}, ${value})`;
}

/** Inverse of buildMeasureQuery, so the case drawer can reopen a case in Measure mode. Null for any other query. */
export function parseMeasureQuery(dax: string): { measure: string; filter: string } | null {
  const s = dax.trim();
  const head = /^EVALUATE\s+ROW\(\s*"v"\s*,\s*([\s\S]*)\)$/i.exec(s);
  if (!head) return null;
  const body = head[1].trim();
  const calc = /^CALCULATE\(\s*((?:'(?:[^']|'')+')?\s*\[(?:[^\]]|\]\])+\])\s*,\s*([\s\S]+)\)$/i.exec(body);
  const asMeasure = (expr: string) => {
    const ref = parseMeasureRef(expr);
    return ref ? (ref.table ? measureExpression(ref) : daxBracket(ref.measure)) : null;
  };
  if (calc) {
    const measure = asMeasure(calc[1]);
    return measure ? { measure, filter: calc[2].trim() } : null;
  }
  const measure = /^(?:'(?:[^']|'')+')?\s*\[(?:[^\]]|\]\])+\]$/.test(body) ? asMeasure(body) : null;
  return measure ? { measure, filter: '' } : null;
}

/** Remove leading whitespace and comments (`--`, `//` line comments and block comments). */
export function stripLeadingComments(dax: string): string {
  let s = dax;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '');
    if (s.startsWith('--') || s.startsWith('//')) {
      const nl = s.indexOf('\n');
      s = nl < 0 ? '' : s.slice(nl + 1);
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/', 2);
      s = end < 0 ? '' : s.slice(end + 2);
    }
    if (s === before) return s;
  }
}

/** Raw DAX guard: the query must begin with EVALUATE or DEFINE (ignoring leading whitespace and comments). */
export function checkRawDax(dax: string | null | undefined): string | null {
  const s = (dax ?? '').trim();
  if (!s) return 'DAX query is required.';
  if (s.length > limits.dax.max) return `DAX query must be ${limits.dax.max} characters or fewer (now ${s.length}).`;
  const body = stripLeadingComments(s);
  if (!/^(EVALUATE|DEFINE)\b/i.test(body)) return 'A DAX query must begin with EVALUATE or DEFINE.';
  return null;
}

/** Measure-mode inputs check. Returns per-field messages. */
export function checkMeasureInputs(measure: string, filter: string): { measure?: string; filter?: string } {
  const out: { measure?: string; filter?: string } = {};
  const m = measure.trim();
  if (!m) out.measure = 'Measure is required.';
  else if (m.length > limits.measure.max) out.measure = `Measure must be ${limits.measure.max} characters or fewer.`;
  else if (!parseMeasureRef(m)) out.measure = 'Enter one measure, such as [Total Sales].';
  const f = filter.trim();
  if (f.length > limits.filter.max) out.filter = `Filter must be ${limits.filter.max} characters or fewer.`;
  else if (/^\s*(EVALUATE|DEFINE)\b/i.test(f)) out.filter = 'Enter a filter expression, not a query.';
  else if (f && unbalanced(f)) out.filter = 'Brackets or quotes in the filter are not balanced.';
  return out;
}

/** True when parentheses, brackets or quotes are unbalanced (string and quoted-name aware). */
export function unbalanced(expr: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      const end = closeQuote(expr, i, c);
      if (end < 0) return true;
      i = end + 1;
      continue;
    }
    if (c === '[') {
      let end = expr.indexOf(']', i + 1);
      while (end >= 0 && expr[end + 1] === ']') end = expr.indexOf(']', end + 2);
      if (end < 0) return true;
      i = end + 1;
      continue;
    }
    if (c === ']') return true;
    if (c === '(') depth++;
    if (c === ')' && --depth < 0) return true;
    i++;
  }
  return depth !== 0;
}

function closeQuote(s: string, start: number, q: string): number {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === q) {
      if (s[i + 1] === q) {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}
