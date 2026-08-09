import {
  assertValidBoxDraft,
  isExpired,
  parseGs1Expiration,
  usableQuantity,
  type MedicationBox,
} from '../inventory';

const box: MedicationBox = {
  id: 1,
  specialtyCis: '1',
  specialtyName: 'Médicament test',
  pharmaceuticalForm: null,
  presentationCip13: '3400000000000',
  presentationLabel: 'Boîte test',
  lot: 'LOT',
  serialNumber: null,
  expirationDate: '2027-12-31',
  initialQuantity: 30,
  remainingQuantity: 12,
  scanRaw: 'raw',
};

describe('inventaire', () => {
  it('convertit uniquement une péremption GS1 calendaire valide', () => {
    expect(parseGs1Expiration('271231')).toBe('2027-12-31');
    expect(parseGs1Expiration('270231')).toBeNull();
    expect(parseGs1Expiration('271200')).toBeNull();
  });

  it('considère une boîte périmée seulement après sa date de péremption', () => {
    expect(isExpired('2027-12-31', '2027-12-31')).toBe(false);
    expect(isExpired('2027-12-31', '2028-01-01')).toBe(true);
  });

  it('exclut intégralement une boîte périmée du stock utilisable', () => {
    expect(usableQuantity(box, '2027-01-01')).toBe(12);
    expect(usableQuantity(box, '2028-01-01')).toBe(0);
  });

  it('refuse d’inventer une quantité initiale ou une identification', () => {
    expect(() =>
      assertValidBoxDraft({
        ...box,
        presentationCip13: '',
        initialQuantity: Number.NaN,
      }),
    ).toThrow('identifié');
    expect(() =>
      assertValidBoxDraft({
        ...box,
        initialQuantity: 0,
      }),
    ).toThrow('quantité initiale');
  });
});
