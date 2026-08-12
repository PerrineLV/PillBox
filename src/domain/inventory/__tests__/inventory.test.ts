import {
  assertValidBoxDraft,
  findDuplicateLotBox,
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
  expirationDate: '2027-12-31',
  initialQuantity: 30,
  remainingQuantity: 12,
  origin: 'SCAN',
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

  it('accepte une boîte saisie manuellement, sans donnée de scan', () => {
    expect(() =>
      assertValidBoxDraft({ ...box, origin: 'MANUAL', scanRaw: null }),
    ).not.toThrow();
    expect(() => assertValidBoxDraft({ ...box, origin: 'MANUAL' })).toThrow(
      'manuellement',
    );
  });

  it('exige le lot d’une boîte ajoutée sans DataMatrix', () => {
    expect(() =>
      assertValidBoxDraft({
        ...box,
        origin: 'MANUAL',
        scanRaw: null,
        lot: null,
      }),
    ).toThrow('lot est requis');
    expect(() =>
      assertValidBoxDraft({
        ...box,
        origin: 'MANUAL',
        scanRaw: null,
        lot: '   ',
      }),
    ).toThrow('lot est requis');
  });

  it('accepte encore une boîte scannée dont le DataMatrix ne porte aucun lot', () => {
    expect(() =>
      assertValidBoxDraft({ ...box, origin: 'SCAN', lot: null }),
    ).not.toThrow();
  });

  it('exige toujours la chaîne brute d’une boîte déclarée scannée', () => {
    expect(() =>
      assertValidBoxDraft({ ...box, origin: 'SCAN', scanRaw: null }),
    ).toThrow('scan DataMatrix brut');
    expect(() =>
      assertValidBoxDraft({ ...box, origin: 'SCAN', scanRaw: '' }),
    ).toThrow('scan DataMatrix brut');
  });

  it('exige une péremption valide, y compris en saisie manuelle', () => {
    expect(() =>
      assertValidBoxDraft({
        ...box,
        origin: 'MANUAL',
        scanRaw: null,
        expirationDate: '2027-02-31',
      }),
    ).toThrow('invalide');
    expect(() =>
      assertValidBoxDraft({
        ...box,
        origin: 'MANUAL',
        scanRaw: null,
        expirationDate: '',
      }),
    ).toThrow('AAAA-MM-JJ');
  });
});

describe('détection d’un lot déjà en stock', () => {
  it('signale une boîte existante du même lot, pour la même présentation, avec du stock restant', () => {
    const existing = { ...box, id: 2, remainingQuantity: 5 };
    expect(
      findDuplicateLotBox([existing], box.presentationCip13, box.lot),
    ).toBe(existing);
  });

  it('ignore une boîte du même lot dont le stock restant est épuisé', () => {
    const exhausted = { ...box, id: 2, remainingQuantity: 0 };
    expect(
      findDuplicateLotBox([exhausted], box.presentationCip13, box.lot),
    ).toBeNull();
  });

  it('ne compare jamais un lot vide, ni côté nouvelle boîte ni côté stock', () => {
    const existing = { ...box, id: 2, remainingQuantity: 5 };
    expect(
      findDuplicateLotBox([existing], box.presentationCip13, null),
    ).toBeNull();
    expect(
      findDuplicateLotBox([existing], box.presentationCip13, '   '),
    ).toBeNull();
    expect(
      findDuplicateLotBox(
        [{ ...existing, lot: null }],
        box.presentationCip13,
        box.lot,
      ),
    ).toBeNull();
  });

  it('ne compare jamais deux présentations différentes, même avec un lot identique', () => {
    const existing = {
      ...box,
      id: 2,
      remainingQuantity: 5,
      presentationCip13: '3400000000001',
    };
    expect(
      findDuplicateLotBox([existing], box.presentationCip13, box.lot),
    ).toBeNull();
  });
});
