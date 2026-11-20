#!/usr/bin/env node
// Developer check: runs a set of DAX queries against the demo model via tools/dax-probe.mjs.
//   node tools/demo-model/verify.mjs <datasetId>
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const id = process.argv[2];
if (!id) { console.error('usage: node tools/demo-model/verify.mjs <datasetId>'); process.exit(1); }
const probe = fileURLToPath(new URL('../dax-probe.mjs', import.meta.url));

const queries = [
  `EVALUATE ROW("Total Sales", [Total Sales], "Order Count", [Order Count], "Margin %", [Margin %], "Total Cost", [Total Cost], "Avg Order Value", [Avg Order Value], "Units", [Units])`,
  `EVALUATE ROW("v", [Total Sales])`,
  `EVALUATE ROW("v", [Order Count])`,
  `EVALUATE ROW("v", [Margin %])`,
  `EVALUATE ROW("Product", COUNTROWS('Product'), "Store", COUNTROWS('Store'), "Date", COUNTROWS('Date'), "Sales", COUNTROWS('Sales'), "Promo", COUNTROWS('dim_Promo_TBL'))`,
  `EVALUATE ROW("v", CALCULATE([Total Sales], 'Date'[Year] = 2025))`,
  `EVALUATE ROW("BlankColour", COUNTROWS(FILTER('Product', ISBLANK('Product'[Colour]))), "BlankCategory", COUNTROWS(FILTER('Product', ISBLANK('Product'[Category]))))`,
  `EVALUATE INFO.VIEW.MEASURES()`,
  `EVALUATE INFO.VIEW.RELATIONSHIPS()`,
  `EVALUATE INFO.VIEW.TABLES()`,
  `EVALUATE TOPN(40, INFO.VIEW.COLUMNS())`,
];

for (const q of queries) {
  console.log(`\n> ${q}`);
  try {
    console.log(execFileSync(process.execPath, [probe, id, q], { encoding: 'utf8' }).trim());
  } catch (e) {
    console.log(`FAILED: ${(e.stderr || e.message).toString().trim()}`);
  }
}
