import { parseStockQuantity } from '../stock-quantity';

describe('saisie du stock final', () => {
  it.each([
    ['0', 0],
    ['90', 90],
    ['1000000', 1000000],
    ['2,5', 2.5],
    ['2.50', 2.5],
    [' 90 ', 90],
    ['4503599627370495.5', Number.MAX_SAFE_INTEGER / 2],
  ])('lit %s sans arrondi', (text, expected) => {
    expect(parseStockQuantity(text)).toBe(expected);
  });
  it.each([
    '',
    ' ',
    '-1',
    'abc',
    'NaN',
    'Infinity',
    '1e2',
    '2,',
    '2.25',
    '2.49999999999999999',
    '4503599627370496',
  ])('refuse %s', (text) => {
    expect(() => parseStockQuantity(text)).toThrow('Saisissez');
  });
});
