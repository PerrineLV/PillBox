import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';

import { normalizeScannedGtinToCip13 } from '../normalize-scanned-identifier';

const VALIDATED_SCANS = [
  {
    raw: '\u001d01034009302278862148173406741300\u001d1052266\u001d17280531',
    gtin: '03400930227886',
    cip13: '3400930227886',
  },
  {
    raw: '\u001d01034009302193932182123689467486\u001d1731022810T62424A',
    gtin: '03400930219393',
    cip13: '3400930219393',
  },
  {
    raw: '\u001d01034009302525121730022810260634\u001d2199367033346207',
    gtin: '03400930252512',
    cip13: '3400930252512',
  },
] as const;

describe('normalizeScannedGtinToCip13', () => {
  it.each(VALIDATED_SCANS)(
    'reproduit la correspondance réelle $gtin vers $cip13',
    ({ raw, gtin, cip13 }) => {
      const parsed = parseGs1DataMatrix(raw);

      expect(parsed.fields.gtin).toBe(gtin);
      expect(normalizeScannedGtinToCip13(parsed.fields.gtin ?? '')).toBe(cip13);
    },
  );

  it.each([
    ['GTIN-14 sans indicateur 0', '13400930227883'],
    ['clé de contrôle invalide', '03400930227887'],
    ['CIP13 fourni directement', '3400930227886'],
    ['caractère non numérique', '0340093022788A'],
    ['valeur vide', ''],
  ])('refuse %s sans produire de candidat approximatif', (_label, value) => {
    expect(normalizeScannedGtinToCip13(value)).toBeNull();
  });
});
