// Builds the TMDL definition of the fictional "X10 Retail Demo Model".
// All data is generated deterministically (seeded PRNG) and embedded as DATATABLE /
// CALENDAR calculated tables, so the model needs no data source and no credentials.

export const MODEL_NAME = 'X10 Retail Demo Model';

// ---- deterministic data -------------------------------------------------------------
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [key, name, category, colour (null = BLANK), unit price]
export const PRODUCTS = [
  [1, 'Trail Backpack', 'Outdoor', 'Green', 79.0],
  [2, 'Camp Lantern', 'Outdoor', 'Black', 34.5],
  [3, 'Folding Chair', 'Outdoor', 'Blue', 45.0],
  [4, 'Chef Knife', 'Kitchen', 'Silver', 59.9],
  [5, 'Cast Pan', 'Kitchen', 'Black', 42.0],
  [6, 'Spice Rack', 'Kitchen', null, 24.0],
  [7, 'Desk Lamp', 'Office', 'White', 38.0],
  [8, 'Notebook Set', 'Office', 'Red', 12.5],
  [9, 'Ergo Mouse', 'Office', 'Grey', 29.0],
  [10, 'Puzzle Cube', 'Toys', 'Yellow', 9.9],
  [11, 'Kite Kit', 'Toys', 'Orange', 22.0],
  [12, 'Wooden Train', 'Toys', 'Brown', 31.0],
];

// [key, name, region, opened (yyyy-mm-dd)]
export const STORES = [
  [1, 'Northgate', 'North', '2024-01-01'],
  [2, 'Harbour View', 'East', '2024-02-15'],
  [3, 'Maple Square', 'West', '2024-04-01'],
  [4, 'Riverside', 'South', '2024-07-10'],
  [5, 'Hilltop', 'North', '2024-11-05'],
  [6, 'Old Town', 'West', '2025-03-20'],
];

export const PROMOS = [
  [1, 'SPRING_SALE_10'],
  [2, 'BACK2SCHOOL'],
  [3, 'BLK_FRI_X'],
  [4, 'NO_PROMO'],
];

const ROUND = (n) => Math.round(n * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);

export function salesRows(count = 320) {
  const rand = mulberry32(20240101);
  const start = Date.UTC(2024, 0, 1);
  const days = 731; // 2024-01-01 .. 2025-12-31
  const rows = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(start + Math.floor(rand() * days) * 86400000);
    const open = STORES.filter(([, , , opened]) => opened <= iso(date));
    const store = open[Math.floor(rand() * open.length)];
    const product = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
    const qty = 1 + Math.floor(rand() * 5);
    const amount = ROUND(product[4] * qty);
    const cost = ROUND(amount * (0.55 + rand() * 0.1));
    rows.push({ orderId: 10001 + i, date: iso(date), productKey: product[0], storeKey: store[0], qty, amount, cost });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.orderId - b.orderId);
}

// ---- TMDL ---------------------------------------------------------------------------
const T = '\t';
const str = (s) => (s === null ? 'BLANK()' : `"${s.replace(/"/g, '""')}"`);
const num = (n) => n.toFixed(2);

function datatable(columns, rows) {
  // columns: [[name, DAXTYPE]]; rows: array of arrays of DAX literal text
  const cols = columns.map(([n, t]) => `"${n}", ${t}`).join(', ');
  const body = rows.map((r) => `{ ${r.join(', ')} }`).join(',\n');
  return [`DATATABLE(`, `${cols},`, `{`, body, `}`, `)`].join('\n');
}

const indentExpr = (expr, tabs) => expr.split('\n').map((l) => T.repeat(tabs) + l).join('\n');

function calcPartition(name, expr) {
  return [`${T}partition ${name} = calculated`, `${T}${T}mode: import`, `${T}${T}source =`, indentExpr(expr, 4)].join('\n');
}

function column(name, { dataType, formatString, hidden, summarizeBy = 'none' }) {
  const lines = [`${T}column ${q(name)}`, `${T}${T}dataType: ${dataType}`];
  if (formatString) lines.push(`${T}${T}formatString: ${formatString}`);
  if (hidden) lines.push(`${T}${T}isHidden`);
  lines.push(`${T}${T}summarizeBy: ${summarizeBy}`, `${T}${T}sourceColumn: [${name}]`);
  return lines.join('\n');
}

function measure(name, expr, { formatString, description, displayFolder } = {}) {
  const lines = [];
  if (description) lines.push(`${T}/// ${description}`);
  lines.push(`${T}measure ${q(name)} = ${expr}`);
  if (formatString) lines.push(`${T}${T}formatString: ${formatString}`);
  if (displayFolder) lines.push(`${T}${T}displayFolder: ${displayFolder}`);
  return lines.join('\n');
}

const q = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

function table(name, { description, measures = [], columns, partition }) {
  const head = [];
  if (description) head.push(`/// ${description}`);
  head.push(`table ${q(name)}`);
  return [head.join('\n'), ...measures, ...columns, partition].join('\n\n') + '\n';
}

function salesTmdl() {
  const rows = salesRows().map((r) => [String(r.orderId), str(r.date), String(r.productKey), String(r.storeKey), String(r.qty), num(r.amount), num(r.cost)]);
  const expr = datatable(
    [['OrderId', 'INTEGER'], ['OrderDate', 'DATETIME'], ['ProductKey', 'INTEGER'], ['StoreKey', 'INTEGER'], ['Quantity', 'INTEGER'], ['Amount', 'CURRENCY'], ['Cost', 'CURRENCY']],
    rows,
  );
  return table('Sales', {
    description: 'Fictional order lines for the demo retail chain, one row per order (2024-2025).',
    measures: [
      measure('Total Sales', 'SUM(Sales[Amount])', { formatString: '#,0.00', description: 'Sum of the sales amount.' }),
      measure('Order Count', 'DISTINCTCOUNT(Sales[OrderId])', { formatString: '#,0', description: 'Number of distinct orders.' }),
      measure('Total Cost', 'SUM(Sales[Cost])'),
      measure('Margin %', 'DIVIDE([Total Sales] - [Total Cost], [Total Sales])', { formatString: '0.0%', description: 'Gross margin as a share of sales.', displayFolder: 'Profitability' }),
      measure('Avg Order Value', 'DIVIDE([Total Sales], [Order Count])', { formatString: '#,0.00' }),
      measure('Units', 'SUM(Sales[Quantity])', { formatString: '#,0' }),
    ],
    columns: [
      column('OrderId', { dataType: 'int64', formatString: '0' }),
      column('OrderDate', { dataType: 'dateTime', formatString: 'yyyy-mm-dd' }),
      column('ProductKey', { dataType: 'int64', formatString: '0', hidden: true }),
      column('StoreKey', { dataType: 'int64', formatString: '0', hidden: true }),
      column('Quantity', { dataType: 'int64', formatString: '0', summarizeBy: 'sum' }),
      column('Amount', { dataType: 'decimal', formatString: '#,0.00', summarizeBy: 'sum' }),
      column('Cost', { dataType: 'decimal', formatString: '#,0.00', summarizeBy: 'sum' }),
    ],
    partition: calcPartition('Sales', expr),
  });
}

function productTmdl() {
  const expr = datatable(
    [['ProductKey', 'INTEGER'], ['Product Name', 'STRING'], ['Category', 'STRING'], ['Colour', 'STRING']],
    PRODUCTS.map(([k, n, c, col]) => [String(k), str(n), str(c), str(col)]),
  );
  return table('Product', {
    description: 'Fictional product catalogue: 12 products across 4 categories.',
    columns: [
      column('ProductKey', { dataType: 'int64', formatString: '0' }),
      column('Product Name', { dataType: 'string' }),
      column('Category', { dataType: 'string' }),
      column('Colour', { dataType: 'string' }),
    ],
    partition: calcPartition('Product', expr),
  });
}

function storeTmdl() {
  const expr = datatable(
    [['StoreKey', 'INTEGER'], ['Store Name', 'STRING'], ['Region', 'STRING'], ['Opened Date', 'DATETIME']],
    STORES.map(([k, n, r, d]) => [String(k), str(n), str(r), str(d)]),
  );
  return table('Store', {
    columns: [
      column('StoreKey', { dataType: 'int64', formatString: '0' }),
      column('Store Name', { dataType: 'string' }),
      column('Region', { dataType: 'string' }),
      column('Opened Date', { dataType: 'dateTime', formatString: 'yyyy-mm-dd' }),
    ],
    partition: calcPartition('Store', expr),
  });
}

function dateTmdl() {
  const expr = [
    'ADDCOLUMNS(',
    '\tCALENDAR(DATE(2024, 1, 1), DATE(2025, 12, 31)),',
    '\t"Year", YEAR([Date]),',
    '\t"Month", MONTH([Date]),',
    '\t"Month Name", FORMAT([Date], "mmmm")',
    ')',
  ].join('\n');
  return table('Date', {
    description: 'Calendar of every day from 2024-01-01 to 2025-12-31.',
    columns: [
      column('Date', { dataType: 'dateTime', formatString: 'yyyy-mm-dd' }),
      column('Year', { dataType: 'int64', formatString: '0' }),
      column('Month', { dataType: 'int64', formatString: '0' }),
      column('Month Name', { dataType: 'string' }),
    ],
    partition: calcPartition('Date', expr),
  });
}

function promoTmdl() {
  const expr = datatable([['PromoKey', 'INTEGER'], ['PROMO_NAME', 'STRING']], PROMOS.map(([k, n]) => [String(k), str(n)]));
  return table('dim_Promo_TBL', {
    columns: [column('PromoKey', { dataType: 'int64', formatString: '0' }), column('PROMO_NAME', { dataType: 'string' })],
    partition: calcPartition('dim_Promo_TBL', expr),
  });
}

// Fixed names so re-running updateDefinition keeps the same relationship objects.
const RELATIONSHIPS = `relationship Sales_Product
\tfromColumn: Sales.ProductKey
\ttoColumn: Product.ProductKey

relationship Sales_Store
\tcrossFilteringBehavior: bothDirections
\tfromColumn: Sales.StoreKey
\ttoColumn: Store.StoreKey

relationship Sales_OrderDate
\tfromColumn: Sales.OrderDate
\ttoColumn: Date.Date

relationship Store_OpenedDate
\tisActive: false
\tfromColumn: Store.'Opened Date'
\ttoColumn: Date.Date
`;

const DATABASE = `database
\tcompatibilityLevel: 1604
`;

const MODEL = `model Model
\tculture: en-US
\tdefaultPowerBIDataSourceVersion: powerBI_V3
\tsourceQueryCulture: en-US
\tdataAccessOptions
\t\tlegacyRedirects
\t\treturnErrorValuesAsNull

ref table Sales
ref table Product
ref table Store
ref table Date
ref table dim_Promo_TBL
`;

const PBISM = JSON.stringify({ version: '4.0', settings: {} }, null, 2) + '\n';

/** Returns [{ path, content }] for every definition part. */
export function definitionFiles() {
  return [
    { path: 'definition.pbism', content: PBISM },
    { path: 'definition/database.tmdl', content: DATABASE },
    { path: 'definition/model.tmdl', content: MODEL },
    { path: 'definition/tables/Sales.tmdl', content: salesTmdl() },
    { path: 'definition/tables/Product.tmdl', content: productTmdl() },
    { path: 'definition/tables/Store.tmdl', content: storeTmdl() },
    { path: 'definition/tables/Date.tmdl', content: dateTmdl() },
    { path: 'definition/tables/dim_Promo_TBL.tmdl', content: promoTmdl() },
    { path: 'definition/relationships.tmdl', content: RELATIONSHIPS },
  ];
}
