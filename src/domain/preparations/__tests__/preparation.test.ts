import type { MedicationBox } from '@/domain/inventory/inventory';
import type { Treatment } from '@/domain/treatments/treatment';

import {
  generatePreparationSnapshot,
  preparationStartDate,
} from '../preparation';

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    active: true,
    includedInPillbox: true,
    phases: [
      {
        id: 1,
        startDate: '2026-08-01',
        endDate: null,
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
    ],
    ...overrides,
  };
}

function box(overrides: Partial<MedicationBox> = {}): MedicationBox {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    presentationCip13: '3400000000000',
    presentationLabel: 'Boîte',
    lot: 'LOT',
    serialNumber: null,
    expirationDate: '2027-01-01',
    initialQuantity: 30,
    remainingQuantity: 10,
    scanRaw: 'raw',
    ...overrides,
  };
}

describe('génération d’une préparation de sept jours', () => {
  it('commence le lendemain lorsque la préparation est lancée un dimanche', () => {
    expect(preparationStartDate('2026-08-09')).toBe('2026-08-10');
  });

  it('commence aussi le lendemain pour les autres jours', () => {
    expect(preparationStartDate('2026-08-08')).toBe('2026-08-09');
    expect(preparationStartDate('2026-08-10')).toBe('2026-08-11');
  });

  it('fige chaque date, créneau, identité et quantité pendant exactement 7 jours', () => {
    const source = treatment();
    const snapshot = generatePreparationSnapshot(
      [source],
      [box()],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.endDate).toBe('2026-08-09');
    expect(snapshot.items).toHaveLength(7);
    expect(snapshot.items[0]).toEqual({
      treatmentId: 1,
      specialtyCis: '60000001',
      specialtyName: 'Alpha',
      pharmaceuticalForm: 'comprimé',
      date: '2026-08-03',
      slot: 'morning',
      quantityHalfUnits: 2,
    });
    source.specialtyName = 'Nom modifié';
    source.phases = [];
    expect(snapshot.items[0].specialtyName).toBe('Alpha');
    expect(snapshot.items).toHaveLength(7);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });

  it('additionne exactement les fractions et plusieurs prises quotidiennes', () => {
    const multi = treatment({
      phases: [
        {
          id: 1,
          startDate: '2026-08-01',
          endDate: null,
          frequency: { type: 'daily' },
          dosage: [
            { slot: 'morning', quantityHalfUnits: 1 },
            { slot: 'noon', quantityHalfUnits: 3 },
            { slot: 'bedtime', quantityHalfUnits: 1 },
          ],
        },
      ],
    });
    const snapshot = generatePreparationSnapshot(
      [multi],
      [box({ remainingQuantity: 17 })],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.items).toHaveLength(21);
    expect(snapshot.requirements[0]).toEqual({
      specialtyCis: '60000001',
      specialtyName: 'Alpha',
      requiredHalfUnits: 35,
      usableStockHalfUnits: 34,
      missingHalfUnits: 1,
    });
    expect(snapshot.hasShortages).toBe(true);
  });

  it('regroupe plusieurs traitements de la même spécialité', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment(), treatment({ id: 2 })],
      [box()],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.requirements).toHaveLength(1);
    expect(snapshot.requirements[0].requiredHalfUnits).toBe(28);
  });

  it('exclut du stock utilisable les boîtes périmées sans suggérer de solution', () => {
    const snapshot = generatePreparationSnapshot(
      [treatment()],
      [box({ expirationDate: '2026-08-02', remainingQuantity: 30 })],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.requirements[0]).toMatchObject({
      requiredHalfUnits: 14,
      usableStockHalfUnits: 0,
      missingHalfUnits: 14,
    });
  });

  it('ignore les traitements inactifs ou exclus', () => {
    const snapshot = generatePreparationSnapshot(
      [
        treatment({ active: false }),
        treatment({ id: 2, includedInPillbox: false }),
      ],
      [],
      '2026-08-03',
      '2026-08-03',
    );
    expect(snapshot.items).toEqual([]);
    expect(snapshot.requirements).toEqual([]);
    expect(snapshot.hasShortages).toBe(false);
  });
});
