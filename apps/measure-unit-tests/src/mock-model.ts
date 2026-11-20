/**
 * Offline stand-in for the "X10 Retail Demo Model", used in demo mode, Vitest and Playwright.
 * It answers the seed DAX exactly (from SEED_EXPECTED), Measure-mode queries for the model's known measures, and
 * simple table queries; an unknown measure gives the same kind of query error Power BI returns.
 */
import { errorResult, MockModelClient, scalarResult, tableResult, type ModelQueryResult } from '@x10/shared/connectors';

import { MODEL_LABEL } from './config';
import { parseMeasureQuery, parseMeasureRef, stripLeadingComments } from './domain/dax';
import { SEED_DAX, SEED_EXPECTED } from './seed';

const norm = (q: string) => stripLeadingComments(q).replace(/\s+/g, ' ').trim().toLowerCase();

const STORES = ['Harbourside', 'Northgate', 'Riverside', 'Westfield Park', 'Old Town', 'Airport Plaza', 'Lakeview', 'Hillcrest'];
const PRODUCTS: [string, string, string | null][] = [
  ['Trail Bottle 750 ml', 'Accessories', 'Blue'],
  ['Puncture Repair Kit', 'Accessories', 'Black'],
  ['Bike Light Set', 'Accessories', null],
  ['City Commuter Bike', 'Bikes', 'Grey'],
  ['Gravel Explorer Bike', 'Bikes', 'Green'],
  ['Kids Balance Bike', 'Bikes', 'Red'],
  ['Rain Shell Jacket', 'Clothing', 'Yellow'],
  ['Merino Base Layer', 'Clothing', 'Black'],
  ['Cycling Gloves', 'Clothing', 'Black'],
  ['Road Racer Frame', 'Components', 'White'],
  ['Carbon Seat Post', 'Components', 'Black'],
  ['Tubeless Wheel Set', 'Components', 'Black'],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Mock tables, sized like the real model: Store 6 rows, Product 12, Date 731 (2024-01-01 to 2025-12-31). */
export function mockTables(): Record<string, { columns: string[]; rows: unknown[][] }> {
  const start = Date.UTC(2024, 0, 1);
  return {
    store: {
      columns: ['Store[Store Key]', 'Store[Store Name]', 'Store[Region]'],
      rows: Array.from({ length: SEED_EXPECTED.storeCount }, (_, i) => [
        i + 1,
        STORES[i % STORES.length] + (i >= STORES.length ? ` ${Math.floor(i / STORES.length) + 1}` : ''),
        ['North', 'South', 'East', 'West'][i % 4],
      ]),
    },
    product: {
      columns: ['Product[Product Key]', 'Product[Product Name]', 'Product[Category]', 'Product[Colour]'],
      rows: Array.from({ length: SEED_EXPECTED.productCount }, (_, i) => {
        const [name, category, colour] = PRODUCTS[i % PRODUCTS.length];
        return [i + 1, name, category, colour];
      }),
    },
    date: {
      columns: ['Date[Date]', 'Date[Year]', 'Date[Month]', 'Date[Month Name]'],
      rows: Array.from({ length: SEED_EXPECTED.dateCount }, (_, i) => {
        const d = new Date(start + i * 86_400_000);
        return [d.toISOString().slice(0, 10), d.getUTCFullYear(), d.getUTCMonth() + 1, MONTHS[d.getUTCMonth()]];
      }),
    },
  };
}

/** Measure values the mock knows, keyed by lower-case measure name. */
export function mockMeasures(): Record<string, number> {
  return {
    'total sales': SEED_EXPECTED.totalSales,
    'order count': SEED_EXPECTED.orderCount,
    'total cost': SEED_EXPECTED.modelTotalCost,
    'margin %': SEED_EXPECTED.modelMarginPct,
    'avg order value': SEED_EXPECTED.modelAvgOrderValue,
    units: SEED_EXPECTED.modelUnits,
  };
}

function unknownMeasure(name: string): ModelQueryResult {
  return errorResult(
    'query',
    `The value for '${name}' cannot be determined. Either the measure does not exist, or there is no current row for a column named '${name}'.`,
  );
}

/** Share of the total for a filter: by year it follows the real 2025 sales split; other filters get a stable share. */
function filterShare(filter: string): number {
  const share2025 = SEED_EXPECTED.modelSales2025 / SEED_EXPECTED.totalSales;
  const year = /\[Year\]\s*=\s*(\d{4})/i.exec(filter)?.[1];
  if (year) return year === '2025' ? share2025 : year === '2024' ? 1 - share2025 : 0;
  let h = 0;
  for (const ch of filter) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 0.1 + (h % 50) / 100;
}

/** Answer one query. Exported for unit tests. */
export function answerMockQuery(query: string): ModelQueryResult {
  const q = norm(query);
  const seed = Object.fromEntries(Object.entries(SEED_DAX).map(([k, v]) => [norm(v), k])) as Record<string, keyof typeof SEED_DAX | undefined>;
  switch (seed[q]) {
    case 'totalSales':
      return scalarResult(SEED_EXPECTED.totalSales, '[v]', 'Decimal');
    case 'orderCount':
      return scalarResult(SEED_EXPECTED.orderCount, '[v]', 'Int64');
    case 'marginPct':
      return scalarResult(SEED_EXPECTED.modelMarginPct, '[v]', 'Double');
    case 'firstCategory':
      return tableResult(['Product[Category]'], [[SEED_EXPECTED.firstCategory]]);
    case 'storeRows': {
      const t = mockTables().store;
      return tableResult(t.columns, t.rows);
    }
    case 'sales2025':
      return scalarResult(SEED_EXPECTED.modelSales2025, '[v]', 'Decimal');
    case 'unknownMeasure':
      return unknownMeasure(SEED_EXPECTED.unknownMeasure);
    case 'totalCost':
      return scalarResult(SEED_EXPECTED.modelTotalCost, '[v]', 'Decimal');
  }

  // Measure mode: EVALUATE ROW("v", [M]) or EVALUATE ROW("v", CALCULATE([M], filter)).
  const mq = parseMeasureQuery(stripLeadingComments(query));
  if (mq) {
    const ref = parseMeasureRef(mq.measure);
    const measures = mockMeasures();
    const value = ref ? measures[ref.measure.toLowerCase()] : undefined;
    if (value === undefined) return unknownMeasure(ref?.measure ?? mq.measure);
    if (!mq.filter) return scalarResult(value, '[v]', 'Double');
    const ratio = ref!.measure.toLowerCase() === 'margin %' || ref!.measure.toLowerCase() === 'avg order value';
    const share = filterShare(mq.filter);
    const v = ratio ? value * (0.92 + share / 4) : value * share;
    return scalarResult(Number(v.toFixed(ref!.measure.toLowerCase() === 'order count' || ref!.measure.toLowerCase() === 'units' ? 0 : 2)), '[v]', 'Double');
  }

  // Simple table queries: EVALUATE 'Store', EVALUATE Product, EVALUATE VALUES('Product'[Category]).
  const tables = mockTables();
  const count = /^evaluate\s+row\(\s*"[^"]*"\s*,\s*countrows\(\s*'?([a-z ]+?)'?\s*\)\s*\)$/.exec(q);
  if (count && tables[count[1]]) return scalarResult(tables[count[1]].rows.length, '[v]', 'Int64');
  const whole = /^evaluate\s+'?([a-z ]+?)'?$/.exec(q);
  if (whole && tables[whole[1]]) return tableResult(tables[whole[1]].columns, tables[whole[1]].rows);
  const values = /^evaluate\s+(?:distinct|values)\(\s*'?([a-z ]+?)'?\[([^\]]+)\]\s*\)$/.exec(q);
  if (values && tables[values[1]]) {
    const t = tables[values[1]];
    const idx = t.columns.findIndex((c) => c.toLowerCase().endsWith(`[${values[2]}]`));
    if (idx >= 0) {
      const distinct = [...new Set(t.rows.map((r) => r[idx]))];
      return tableResult([t.columns[idx]], distinct.map((v) => [v]));
    }
  }
  if (/^\s*(evaluate|define)\b/.test(q) && /\{\s*\}/.test(q)) return tableResult(['[Value]'], []);
  return errorResult(
    'query',
    'The offline demo model only answers the sample queries, Measure-mode queries for [Total Sales], [Order Count], [Total Cost], [Margin %], [Avg Order Value] and [Units], and EVALUATE of the Store, Product or Date tables. Deployed, the query runs against your semantic model.',
  );
}

/**
 * Extra latency per query, from 0 to 2× the base, stable per query text, so a demo run streams results at a
 * believable, uneven pace and the duration lens has something to show.
 */
export function mockJitter(query: string, baseMs: number): number {
  if (!baseMs) return 0;
  let h = 7;
  for (const ch of norm(query)) h = (h * 31 + ch.charCodeAt(0)) % 10_007;
  return Math.round(((h % 100) / 100) * 2 * baseMs);
}

export function createMockModelClient(latencyMs = 0): MockModelClient {
  const answer = async (q: string) => {
    const extra = mockJitter(q, latencyMs);
    if (extra) await new Promise((r) => setTimeout(r, extra));
    return answerMockQuery(q);
  };
  return new MockModelClient(answer, `${MODEL_LABEL} (offline sample)`, latencyMs);
}
