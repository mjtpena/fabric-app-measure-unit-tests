import {
  buildMeasureQuery,
  checkMeasureInputs,
  checkRawDax,
  parseMeasureQuery,
  parseMeasureRef,
  stripLeadingComments,
  unbalanced,
} from './dax';

describe('Measure mode query builder', () => {
  it('builds the spec example', () => {
    expect(buildMeasureQuery('[Total Sales]', "'Date'[Year] = 2025")).toBe(
      `EVALUATE ROW("v", CALCULATE([Total Sales], 'Date'[Year] = 2025))`,
    );
  });
  it('without a filter evaluates the measure as is', () => {
    expect(buildMeasureQuery('[Total Sales]')).toBe('EVALUATE ROW("v", [Total Sales])');
    expect(buildMeasureQuery('Total Sales', '   ')).toBe('EVALUATE ROW("v", [Total Sales])');
  });
  it('quotes names with the shared helpers', () => {
    expect(buildMeasureQuery('[Sales]] Net]')).toBe('EVALUATE ROW("v", [Sales]] Net])');
    expect(buildMeasureQuery("'Sales Order'[Margin %]")).toBe(`EVALUATE ROW("v", 'Sales Order'[Margin %])`);
    expect(buildMeasureQuery("'O''Brien'[Units]")).toBe(`EVALUATE ROW("v", 'O''Brien'[Units])`);
    expect(buildMeasureQuery('Sales[Units]')).toBe(`EVALUATE ROW("v", 'Sales'[Units])`);
  });
  it('throws on something that is not a measure', () => {
    expect(() => buildMeasureQuery('SUM(Sales[Amount])')).toThrow(/measure/);
    expect(() => buildMeasureQuery('')).toThrow();
  });
  it('round-trips through parseMeasureQuery', () => {
    for (const [m, f] of [
      ['[Total Sales]', "'Date'[Year] = 2025"],
      ['[Order Count]', ''],
      ["'Sales'[Margin %]", "'Store'[Region] = \"North\""],
    ]) {
      expect(parseMeasureQuery(buildMeasureQuery(m, f))).toEqual({ measure: m, filter: f });
    }
  });
  it('parseMeasureQuery returns null for other queries', () => {
    expect(parseMeasureQuery(`EVALUATE 'Store'`)).toBeNull();
    expect(parseMeasureQuery('EVALUATE ROW("v", SUM(Sales[Amount]))')).toBeNull();
    expect(parseMeasureQuery('EVALUATE ROW("x", [Total Sales])')).toBeNull();
  });
});

describe('parseMeasureRef', () => {
  it('accepts the usual spellings', () => {
    expect(parseMeasureRef('[Total Sales]')).toEqual({ table: null, measure: 'Total Sales' });
    expect(parseMeasureRef(' Total Sales ')).toEqual({ table: null, measure: 'Total Sales' });
    expect(parseMeasureRef("'Sales'[Total Sales]")).toEqual({ table: 'Sales', measure: 'Total Sales' });
  });
  it('rejects expressions', () => {
    expect(parseMeasureRef('[A] + [B]')).toBeNull();
    expect(parseMeasureRef('CALCULATE([A])')).toBeNull();
    expect(parseMeasureRef('')).toBeNull();
  });
});

describe('checkMeasureInputs', () => {
  it('validates measure and filter', () => {
    expect(checkMeasureInputs('', '')).toEqual({ measure: 'Measure is required.' });
    expect(checkMeasureInputs('[A] + [B]', '').measure).toMatch(/one measure/);
    expect(checkMeasureInputs('[Total Sales]', "'Date'[Year] = 2025")).toEqual({});
    expect(checkMeasureInputs('[Total Sales]', 'EVALUATE Sales').filter).toMatch(/not a query/);
    expect(checkMeasureInputs('[Total Sales]', "'Date'[Year] = (2025").filter).toMatch(/balanced/);
  });
  it('unbalanced is quote and bracket aware', () => {
    expect(unbalanced(`'Store'[Region] = "North (A)"`)).toBe(false);
    expect(unbalanced(`'Store'[Re]]gion] = 1`)).toBe(false);
    expect(unbalanced(`'Store[Region] = 1`)).toBe(true);
    expect(unbalanced(`'Store'[Region = 1`)).toBe(true);
    expect(unbalanced(`(a))`)).toBe(true);
  });
});

describe('Raw DAX guard', () => {
  it('accepts EVALUATE and DEFINE in any case', () => {
    expect(checkRawDax(`EVALUATE 'Store'`)).toBeNull();
    expect(checkRawDax('evaluate ROW("v", 1)')).toBeNull();
    expect(checkRawDax('DEFINE MEASURE Sales[X] = 1 EVALUATE ROW("v", [X])')).toBeNull();
  });
  it('ignores leading whitespace and comments', () => {
    expect(checkRawDax('\n\t  EVALUATE Sales')).toBeNull();
    expect(checkRawDax('-- sales check\nEVALUATE Sales')).toBeNull();
    expect(checkRawDax('// check\n  // another\nDEFINE VAR x = 1 EVALUATE ROW("v", x)')).toBeNull();
    expect(checkRawDax('/* multi\nline */ EVALUATE Sales')).toBeNull();
    expect(checkRawDax('/* a */ -- b\n /* c */EVALUATE Sales')).toBeNull();
  });
  it('rejects anything else', () => {
    expect(checkRawDax('')).toMatch(/required/);
    expect(checkRawDax('SELECT * FROM Sales')).toMatch(/EVALUATE or DEFINE/);
    expect(checkRawDax('[Total Sales]')).toMatch(/EVALUATE or DEFINE/);
    expect(checkRawDax('EVALUATEX')).toMatch(/EVALUATE or DEFINE/);
    expect(checkRawDax('-- EVALUATE in a comment only')).toMatch(/EVALUATE or DEFINE/);
    expect(checkRawDax('/* unterminated EVALUATE Sales')).toMatch(/EVALUATE or DEFINE/);
    expect(checkRawDax('EVALUATE ' + 'x'.repeat(4000))).toMatch(/4000/);
  });
  it('stripLeadingComments keeps the body', () => {
    expect(stripLeadingComments('  -- a\n/* b */ EVALUATE x -- c')).toBe('EVALUATE x -- c');
  });
});
