import { explainShort, missingObject, splitMessage } from './shorts';

describe('explainShort', () => {
  it('names the missing measure from the model message', () => {
    const s = explainShort(
      "query: The value for 'Revenue YTD' cannot be determined. Either the measure does not exist, or there is no current row for a column named 'Revenue YTD'.",
    );
    expect(s).toMatchObject({ cause: 'missing', category: 'query', object: 'Revenue YTD', title: '[Revenue YTD] is missing from the model' });
    expect(s.detail.startsWith('The value for')).toBe(true);
  });

  it('classifies connector categories', () => {
    expect(explainShort('api: Forbidden').cause).toBe('access');
    expect(explainShort('overflow: More than 1000 rows.').cause).toBe('overflow');
    expect(explainShort('timeout: No answer within 30 s.').cause).toBe('timeout');
    expect(explainShort('network: Failed to fetch').cause).toBe('network');
    expect(explainShort('unknown: 429 CapacityLimitExceeded').cause).toBe('capacity');
    expect(explainShort('query: Query (1, 10) The syntax for ROW is incorrect.').cause).toBe('syntax');
  });

  it('explains comparator errors', () => {
    expect(explainShort('no rows').cause).toBe('empty');
    expect(explainShort('Expected range must look like low..high.').cause).toBe('expectation');
    expect(explainShort('Tolerance must be a number or a percent such as 0.5%.').cause).toBe('expectation');
    expect(explainShort(null)).toMatchObject({ cause: 'unknown', detail: 'No message was recorded.' });
  });

  it('splits only known categories', () => {
    expect(splitMessage('query: boom')).toEqual({ category: 'query', detail: 'boom' });
    expect(splitMessage('Note: not a category')).toEqual({ category: null, detail: 'Note: not a category' });
    expect(missingObject('Column [Amount] not found')).toBe('Amount');
  });
});
