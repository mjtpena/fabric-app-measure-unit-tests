import { errorResult, scalarResult, tableResult } from '@x10/shared/connectors';

import {
  checkExpectation,
  evaluate,
  formatNumber,
  formatValue,
  parseNumber,
  parseRange,
  parseTolerance,
  valueForExpected,
  withinTolerance,
} from './compare';

describe('parseNumber', () => {
  it.each([
    [1234.5, 1234.5],
    ['1234.5', 1234.5],
    ['1,234,567.89', 1234567.89],
    ['$1,234.50', 1234.5],
    ['€ 2 500', 2500],
    ['£-12.5', -12.5],
    ['-$1,000', -1000],
    ['USD 1,000', 1000],
    ['1000 AUD', 1000],
    ['(1,234)', -1234],
    ['45%', 0.45],
    ["1'234'567", 1234567],
    ['1_000', 1000],
    ['1e3', 1000],
    ['.5', 0.5],
  ])('reads %j as %j', (input, want) => {
    expect(parseNumber(input)).toBeCloseTo(want as number, 10);
  });

  it.each([[''], ['   '], ['abc'], ['12abc'], [null], [undefined], [true], [{}], [Number.NaN], ['1.2.3']])('rejects %j', (input) => {
    expect(parseNumber(input)).toBeNull();
  });
});

describe('tolerance', () => {
  it('defaults to the absolute float-noise tolerance', () => {
    expect(parseTolerance('')).toEqual({ kind: 'abs', value: 0.000001 });
    expect(parseTolerance(null)).toEqual({ kind: 'abs', value: 0.000001 });
  });
  it('reads absolute and percent forms', () => {
    expect(parseTolerance('0.01')).toEqual({ kind: 'abs', value: 0.01 });
    expect(parseTolerance('0.5%')).toEqual({ kind: 'pct', value: 0.5 });
    expect(parseTolerance(' 2 % ')).toEqual({ kind: 'pct', value: 2 });
    expect(parseTolerance('abc')).toBeNull();
    expect(parseTolerance('-1')).toBeNull();
  });
  it('absolute tolerance', () => {
    expect(withinTolerance(100.004, 100, { kind: 'abs', value: 0.01 })).toBe(true);
    expect(withinTolerance(100.02, 100, { kind: 'abs', value: 0.01 })).toBe(false);
    expect(withinTolerance(100.01, 100, { kind: 'abs', value: 0.01 })).toBe(true);
  });
  it('percent tolerance is relative to expected', () => {
    expect(withinTolerance(1004, 1000, { kind: 'pct', value: 0.5 })).toBe(true);
    expect(withinTolerance(1006, 1000, { kind: 'pct', value: 0.5 })).toBe(false);
    expect(withinTolerance(-995, -1000, { kind: 'pct', value: 0.5 })).toBe(true);
  });
  it('absorbs floating-point noise by default', () => {
    expect(withinTolerance(0.1 + 0.2, 0.3, parseTolerance('')!)).toBe(true);
    expect(withinTolerance(0.30001, 0.3, parseTolerance('')!)).toBe(false);
  });
});

describe('parseRange', () => {
  it('reads low..high', () => {
    expect(parseRange('0.2..0.6')).toEqual({ low: 0.2, high: 0.6 });
    expect(parseRange('20%..60%')).toEqual({ low: 0.2, high: 0.6 });
    expect(parseRange('-5..-1')).toEqual({ low: -5, high: -1 });
    expect(parseRange('1,000..$2,000')).toEqual({ low: 1000, high: 2000 });
  });
  it('rejects bad ranges', () => {
    expect(parseRange('0.6..0.2')).toBeNull();
    expect(parseRange('0.2-0.6')).toBeNull();
    expect(parseRange('a..b')).toBeNull();
    expect(parseRange('')).toBeNull();
  });
});

describe('evaluate: scalar', () => {
  it('passes numbers within tolerance and strips separators and currency symbols', () => {
    expect(evaluate('scalar', scalarResult(34054.7), '$34,054.70', '0.01').status).toBe('pass');
    expect(evaluate('scalar', scalarResult('34,054.70'), '34054.7', '').status).toBe('pass');
    expect(evaluate('scalar', scalarResult(0.1 + 0.2), '0.3', null)).toMatchObject({ status: 'pass', actual: '0.3' });
  });
  it('fails numbers outside tolerance with the difference', () => {
    const v = evaluate('scalar', scalarResult(13709), '15,000', '1%');
    expect(v.status).toBe('fail');
    expect(v.actual).toBe('13709');
    expect(v.message).toMatch(/Off by -1291 \(-8\.61%\); tolerance ±1%/);
  });
  it('percent tolerance', () => {
    expect(evaluate('scalar', scalarResult(1004), '1000', '0.5%').status).toBe('pass');
    expect(evaluate('scalar', scalarResult(1006), '1000', '0.5%').status).toBe('fail');
  });
  it('absolute tolerance', () => {
    expect(evaluate('scalar', scalarResult(10.4), '10', '0.5').status).toBe('pass');
    expect(evaluate('scalar', scalarResult(10.6), '10', '0.5').status).toBe('fail');
  });
  it('compares text exactly', () => {
    expect(evaluate('scalar', scalarResult('Accessories'), 'Accessories', '').status).toBe('pass');
    expect(evaluate('scalar', scalarResult('accessories'), 'Accessories', '').status).toBe('fail');
  });
  it('fails a blank or a text actual for a numeric expected', () => {
    expect(evaluate('scalar', scalarResult(null), '10', '').status).toBe('fail');
    expect(evaluate('scalar', scalarResult('n/a'), '10', '').status).toBe('fail');
  });
  it('reads only the first cell', () => {
    expect(evaluate('scalar', tableResult(['a', 'b'], [[5, 99], [7, 8]]), '5', '').status).toBe('pass');
  });
  it('errors on a missing expected value or an unreadable tolerance', () => {
    expect(evaluate('scalar', scalarResult(5), '', '').status).toBe('error');
    expect(evaluate('scalar', scalarResult(5), '5', 'lots').status).toBe('error');
  });
});

describe('evaluate: other kinds', () => {
  it('rowcount counts rows, zero included', () => {
    const rows = Array.from({ length: 6 }, (_, i) => [i]);
    expect(evaluate('rowcount', tableResult(['k'], rows), '6')).toMatchObject({ status: 'pass', actual: '6' });
    expect(evaluate('rowcount', tableResult(['k'], rows), '5')).toMatchObject({ status: 'fail', message: 'Expected 5 rows, got 6.' });
    expect(evaluate('rowcount', tableResult(['k'], []), '0').status).toBe('pass');
    expect(evaluate('rowcount', tableResult(['k'], rows), 'six').status).toBe('error');
  });
  it('notblank', () => {
    expect(evaluate('notblank', scalarResult('Bikes'), null).status).toBe('pass');
    expect(evaluate('notblank', scalarResult(0), null).status).toBe('pass');
    expect(evaluate('notblank', scalarResult(null), null).status).toBe('fail');
    expect(evaluate('notblank', scalarResult(''), null).status).toBe('fail');
    expect(evaluate('notblank', scalarResult('  '), null).status).toBe('fail');
  });
  it('between is inclusive', () => {
    expect(evaluate('between', scalarResult(0.403), '0.2..0.6').status).toBe('pass');
    expect(evaluate('between', scalarResult(0.2), '0.2..0.6').status).toBe('pass');
    expect(evaluate('between', scalarResult(0.6), '20%..60%').status).toBe('pass');
    expect(evaluate('between', scalarResult(0.61), '0.2..0.6')).toMatchObject({ status: 'fail', message: '0.61 is above 0.2..0.6.' });
    expect(evaluate('between', scalarResult('x'), '0.2..0.6').status).toBe('fail');
    expect(evaluate('between', scalarResult(1), 'oops').status).toBe('error');
  });
  it('zero rows is an error "no rows" for first-cell kinds', () => {
    for (const kind of ['scalar', 'notblank', 'between'] as const) {
      expect(evaluate(kind, tableResult(['v'], []), '1..2')).toEqual({ status: 'error', actual: null, message: 'no rows' });
    }
  });
  it('a connector failure becomes an error with category and message', () => {
    expect(evaluate('scalar', errorResult('query', 'Bad DAX'), '1')).toEqual({ status: 'error', actual: null, message: 'query: Bad DAX' });
    expect(evaluate('rowcount', errorResult('timeout', 'No answer within 30 s.'), '1').message).toBe('timeout: No answer within 30 s.');
  });
  it('clips long actual values to the column limit', () => {
    const v = evaluate('scalar', scalarResult('x'.repeat(600)), 'y');
    expect(v.actual!.length).toBe(400);
  });
});

describe('valueForExpected ("Use this value as expected")', () => {
  it('numbers are written plainly', () => {
    expect(valueForExpected('scalar', scalarResult(34054.7))).toBe('34054.7');
    expect(valueForExpected('scalar', scalarResult(0.1 + 0.2))).toBe('0.3');
    expect(valueForExpected('scalar', scalarResult(320))).toBe('320');
  });
  it('strings are kept as they are', () => {
    expect(valueForExpected('scalar', scalarResult('Accessories'))).toBe('Accessories');
    expect(valueForExpected('scalar', scalarResult('  North  '))).toBe('North');
  });
  it('rowcount uses the number of rows', () => {
    expect(valueForExpected('rowcount', tableResult(['a'], [[1], [2], [3]]))).toBe('3');
  });
  it('offers nothing for errors, blanks, notblank and between', () => {
    expect(valueForExpected('scalar', errorResult('query', 'x'))).toBeNull();
    expect(valueForExpected('scalar', scalarResult(null))).toBeNull();
    expect(valueForExpected('notblank', scalarResult(1))).toBeNull();
    expect(valueForExpected('between', scalarResult(1))).toBeNull();
  });
  it('round-trips: the suggested value passes', () => {
    for (const v of [34054.7, 0.40312644069687886, 'Bikes', 106.4209]) {
      const r = scalarResult(v);
      expect(evaluate('scalar', r, valueForExpected('scalar', r), '').status).toBe('pass');
    }
  });
});

describe('formatting', () => {
  it('formatValue', () => {
    expect(formatValue(null)).toBe('(blank)');
    expect(formatValue('')).toBe('(empty string)');
    expect(formatValue(1.5)).toBe('1.5');
    expect(formatValue(true)).toBe('true');
  });
  it('formatNumber removes float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1284530.75)).toBe('1284530.75');
  });
});

describe('checkExpectation', () => {
  it('per kind', () => {
    expect(checkExpectation('scalar', '', '').expected).toMatch(/required/);
    expect(checkExpectation('scalar', '10', 'x').tolerance).toBeTruthy();
    expect(checkExpectation('scalar', 'Bikes', '1%').tolerance).toMatch(/numeric/);
    expect(checkExpectation('scalar', '$1,000', '1%')).toEqual({});
    expect(checkExpectation('rowcount', '6.5', '').expected).toMatch(/whole number/);
    expect(checkExpectation('rowcount', '1,200', '')).toEqual({});
    expect(checkExpectation('between', '0.6..0.2', '').expected).toBeTruthy();
    expect(checkExpectation('between', '0.2..0.6', '')).toEqual({});
    expect(checkExpectation('notblank', '', '')).toEqual({});
    expect(checkExpectation('scalar', 'x'.repeat(201), '').expected).toMatch(/200/);
  });
});
