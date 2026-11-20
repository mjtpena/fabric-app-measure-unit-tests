/**
 * Short circuit: turn an error result's message into a plain explanation and a fix. Error messages are stored as
 * `<category>: <message>` (connector failures, see compare.ts) or as a comparator message ("no rows", "Expected range
 * must look like low..high."). Pure functions.
 */

export type ShortCause =
  | 'missing'
  | 'access'
  | 'overflow'
  | 'timeout'
  | 'network'
  | 'capacity'
  | 'syntax'
  | 'empty'
  | 'expectation'
  | 'cancelled'
  | 'unknown';

export interface ShortInfo {
  cause: ShortCause;
  /** Connector category ("query", "api", …) when the message carried one. */
  category: string | null;
  /** The model's own words, without the category prefix. */
  detail: string;
  /** The missing measure, column or table, when the message names one. */
  object: string | null;
  title: string;
  explanation: string;
  fix: string;
}

const KNOWN_CATEGORIES = ['query', 'api', 'network', 'overflow', 'timeout', 'cancelled', 'capacity', 'unknown'];

/** Split "query: The value…" into its category and message. */
export function splitMessage(message: string | null | undefined): { category: string | null; detail: string } {
  const s = (message ?? '').trim();
  const m = /^([a-z_]+):\s*([\s\S]*)$/.exec(s);
  if (m && KNOWN_CATEGORIES.includes(m[1])) return { category: m[1], detail: m[2].trim() };
  return { category: null, detail: s };
}

/** Catalogue of causes, in the order the Short circuit guide lists them. */
export const SHORT_GUIDE: Record<ShortCause, { title: string; explanation: string; fix: string }> = {
  missing: {
    title: 'Missing measure or column',
    explanation: 'The query names something the model does not have. It was usually renamed, moved to another table or deleted.',
    fix: 'Open the probe and point it at the current name, or disable the probe until the model is fixed.',
  },
  access: {
    title: 'No access to the model',
    explanation: 'Queries run as the signed-in person, and the model refused this one.',
    fix: 'Ask the model owner for Build permission, and check that the Execute Queries API tenant setting is on.',
  },
  overflow: {
    title: 'Too many rows',
    explanation: 'The query returned more rows than the run allows, so it was stopped instead of downloading a table.',
    fix: 'Filter the query, or use Row count with COUNTROWS so the model does the counting.',
  },
  timeout: {
    title: 'Timed out',
    explanation: 'The model did not answer within the per-case time limit.',
    fix: 'Simplify the query or filter it to less data, then run the probe again.',
  },
  network: {
    title: 'Connection dropped',
    explanation: 'The request did not reach the model or the answer did not come back.',
    fix: 'Check the connection and run the suite again; nothing is wrong with the probe itself.',
  },
  capacity: {
    title: 'Capacity is busy',
    explanation: 'The Fabric capacity is throttling requests.',
    fix: 'Wait a few minutes and run again, or move the workload to a larger capacity.',
  },
  syntax: {
    title: 'The DAX does not parse',
    explanation: 'The model could not read the query.',
    fix: 'Open the probe, run Test query and correct the DAX it points at.',
  },
  empty: {
    title: 'No rows came back',
    explanation: 'The query ran but returned an empty table, so there was no first cell to compare.',
    fix: 'Check the filter, or switch the probe to Row count if zero rows is a valid answer.',
  },
  expectation: {
    title: 'Expected value cannot be read',
    explanation: 'The query answered, but the probe’s own expected value or tolerance is not in a form the check understands.',
    fix: 'Open the probe and correct Expected (for example 0.2..0.6 for Between) or the tolerance.',
  },
  cancelled: {
    title: 'Cancelled',
    explanation: 'The run was cancelled while this query was waiting.',
    fix: 'Run the suite again.',
  },
  unknown: {
    title: 'Unexpected error',
    explanation: 'The connector reported an error it did not classify.',
    fix: 'Read the model’s message below, run Test query on the probe, and retry.',
  },
};

function causeOf(category: string | null, detail: string): ShortCause {
  const d = detail.toLowerCase();
  if (category === 'overflow' || /more than \d[\d,]* rows/.test(d)) return 'overflow';
  if (category === 'timeout' || /timed out|no answer within|timeout/.test(d)) return 'timeout';
  if (category === 'cancelled') return 'cancelled';
  if (category === 'capacity' || /\b429\b|capacitylimitexceeded|capacity/.test(d)) return 'capacity';
  if (/cannot be determined|does not exist|cannot find|could not be found|not found in the model|unknown (measure|column|table)/.test(d)) return 'missing';
  if (category === 'api' || /\b40[13]\b|forbidden|unauthori[sz]ed|permission|not allowed|access/.test(d)) return 'access';
  if (category === 'network' || /network|failed to fetch|econn|connection/.test(d)) return 'network';
  if (d === 'no rows') return 'empty';
  if (/^expected|tolerance must|must look like/.test(d)) return 'expectation';
  if (category === 'query' || /syntax|parse|unexpected|token|query \(\d+, \d+\)/.test(d)) return 'syntax';
  return 'unknown';
}

/** The object a "missing" message names: `'Revenue YTD'` → Revenue YTD. */
export function missingObject(detail: string): string | null {
  const m = /'((?:[^']|'')+)'/.exec(detail) ?? /\[([^\]]+)\]/.exec(detail);
  return m ? m[1].replace(/''/g, "'") : null;
}

/** Explain an error result's message. */
export function explainShort(message: string | null | undefined): ShortInfo {
  const { category, detail } = splitMessage(message);
  const cause = causeOf(category, detail);
  const guide = SHORT_GUIDE[cause];
  const object = cause === 'missing' ? missingObject(detail) : null;
  return {
    cause,
    category,
    detail: detail || 'No message was recorded.',
    object,
    title: object ? `[${object}] is missing from the model` : guide.title,
    explanation: object
      ? `The model has nothing called ${object}. It was probably renamed, moved to another table or deleted.`
      : guide.explanation,
    fix: guide.fix,
  };
}
