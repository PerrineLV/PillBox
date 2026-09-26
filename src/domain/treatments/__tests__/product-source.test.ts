import { nonBdpmProductKey, productSourceFromKey } from '../treatment';
import {
  assertValidBoxDraft,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import {
  generatePreparationSnapshot,
  listBoxesForMedication,
  verifyPreparationBox,
} from '@/domain/preparations/preparation';
import type { Treatment } from '../treatment';

describe('identifiants des produits hors BDPM', () => {
  it('sépare les compléments et la saisie manuelle des CIS', () => {
    expect(nonBdpmProductKey('COMPL_ALIM', '123')).toBe('COMPL_ALIM:123');
    expect(nonBdpmProductKey('MANUAL', '123')).toBe('MANUAL:123');
    expect(productSourceFromKey('COMPL_ALIM:123')).toBe('COMPL_ALIM');
    expect(productSourceFromKey('MANUAL:123')).toBe('MANUAL');
    expect(productSourceFromKey('60000001')).toBe('BDPM');
    expect(() => nonBdpmProductKey('MANUAL', ' ')).toThrow();
  });
});

it('prépare un complément avec une boîte saisie sans CIP ni scan, sans accepter un autre produit', () => {
  const key = nonBdpmProductKey('COMPL_ALIM', '123');
  const treatment: Treatment = {
    id: 1,
    specialtyCis: key,
    specialtyName: 'Complément déclaré',
    pharmaceuticalForm: 'gélule',
    productSource: 'COMPL_ALIM',
    productType: 'SUPPLEMENT',
    externalId: '123',
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [
      {
        id: 1,
        startDate: '2026-09-01',
        endDate: null,
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
    ],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
  };
  const box: MedicationBox = {
    id: 1,
    specialtyCis: key,
    specialtyName: treatment.specialtyName,
    productSource: 'COMPL_ALIM',
    pharmaceuticalForm: 'gélule',
    presentationCip13: '',
    presentationLabel: 'gélule',
    lot: 'L123',
    expirationDate: '2027-01-01',
    initialQuantity: 30,
    remainingQuantity: 30,
    origin: 'MANUAL',
    scanRaw: null,
  };
  expect(() => assertValidBoxDraft(box)).not.toThrow();
  const snapshot = generatePreparationSnapshot(
    [treatment],
    [box],
    '2026-09-26',
    '2026-09-26',
  );
  expect(snapshot.requirements).toEqual([
    expect.objectContaining({ specialtyCis: key, requiredHalfUnits: 14 }),
  ]);
  expect(listBoxesForMedication(key, 14, [box], '2026-09-26')).toEqual([box]);
  expect(verifyPreparationBox(key, 14, box, [box], '2026-09-26').status).toBe(
    'VALID',
  );
  expect(
    verifyPreparationBox(
      key,
      14,
      { ...box, specialtyCis: 'MANUAL:other' },
      [box],
      '2026-09-26',
    ).status,
  ).toBe('WRONG_MEDICATION');
  expect(() => assertValidBoxDraft({ ...box, origin: 'SCAN' })).toThrow();
});
