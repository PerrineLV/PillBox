import type { MedicationBox } from '@/domain/inventory/inventory';
import type { Treatment } from '@/domain/treatments/treatment';

import {
  assertVerificationEvidence,
  generatePreparationSnapshot,
  listBoxesForMedication,
  matchScannedBox,
  preparationEndDate,
  preparationStartDate,
  preparationWeeks,
  preparationWeekState,
  verifyPreparationBox,
} from '../preparation';

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    includedInPillbox: true,
    archivedAt: null,
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
    expirationDate: '2027-01-01',
    initialQuantity: 30,
    remainingQuantity: 10,
    origin: 'SCAN',
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

  it('ignore les traitements archivés ou exclus du pilulier', () => {
    const snapshot = generatePreparationSnapshot(
      [
        treatment({ archivedAt: '2026-08-01' }),
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

describe('choix de la semaine à préparer', () => {
  it('propose la semaine à venir puis la suivante, sans chevauchement', () => {
    expect(preparationWeeks('2026-08-09')).toEqual([
      { choice: 'CURRENT', startDate: '2026-08-10', endDate: '2026-08-16' },
      { choice: 'NEXT', startDate: '2026-08-17', endDate: '2026-08-23' },
    ]);
  });

  it('traverse les mois sans décaler la durée de sept jours', () => {
    expect(preparationWeeks('2026-08-29')).toEqual([
      { choice: 'CURRENT', startDate: '2026-08-30', endDate: '2026-09-05' },
      { choice: 'NEXT', startDate: '2026-09-06', endDate: '2026-09-12' },
    ]);
    expect(preparationEndDate('2026-12-28')).toBe('2027-01-03');
  });

  it('bloque une semaine déjà validée et signale une préparation à reprendre', () => {
    const known = [
      { id: 1, startDate: '2026-08-10', status: 'COMPLETED' as const },
      { id: 2, startDate: '2026-08-17', status: 'DRAFT' as const },
    ];
    expect(preparationWeekState('2026-08-10', known)).toBe('ALREADY_PREPARED');
    expect(preparationWeekState('2026-08-17', known)).toBe('IN_PROGRESS');
    expect(preparationWeekState('2026-08-24', known)).toBe('AVAILABLE');
    expect(preparationWeekState('2026-08-10', [])).toBe('AVAILABLE');
  });

  it('considère une semaine validée comme préparée même après une nouvelle tentative', () => {
    expect(
      preparationWeekState('2026-08-10', [
        { id: 2, startDate: '2026-08-10', status: 'DRAFT' },
        { id: 1, startDate: '2026-08-10', status: 'COMPLETED' },
      ]),
    ).toBe('ALREADY_PREPARED');
  });
});

describe('vérification des boîtes pendant la préparation', () => {
  it('bloque un produit différent et une boîte périmée', () => {
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        box({ specialtyCis: 'OTHER' }),
        [box()],
        '2026-08-03',
      ).status,
    ).toBe('WRONG_MEDICATION');
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        box({ expirationDate: '2026-08-02' }),
        [box()],
        '2026-08-03',
      ).status,
    ).toBe('EXPIRED');
  });

  it('recommande FEFO mais accepte explicitement un autre lot valide', () => {
    const earliest = box({
      id: 1,
      lot: 'PREMIER',
      expirationDate: '2026-09-01',
    });
    const later = box({ id: 2, lot: 'SUIVANT', expirationDate: '2027-01-01' });
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        earliest,
        [later, earliest],
        '2026-08-03',
      ),
    ).toMatchObject({ status: 'VALID', isFefo: true });
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        later,
        [later, earliest],
        '2026-08-03',
      ),
    ).toMatchObject({
      status: 'VALID',
      isFefo: false,
      recommendedBox: earliest,
    });
  });

  it('relie le scan à une seule boîte avec présentation, lot et péremption exacts', () => {
    const stored = box();
    expect(
      matchScannedBox(
        {
          presentationCip13: stored.presentationCip13,
          lot: 'LOT',
          expirationDate: '2027-01-01',
        },
        [stored],
      ),
    ).toEqual({ status: 'MATCHED', box: stored });
    expect(
      matchScannedBox(
        {
          presentationCip13: stored.presentationCip13,
          lot: 'AUTRE',
          expirationDate: '2027-01-01',
        },
        [stored],
      ),
    ).toEqual({ status: 'UNKNOWN' });
    expect(
      matchScannedBox(
        {
          presentationCip13: stored.presentationCip13,
          lot: 'LOT',
          expirationDate: '2027-01-01',
        },
        [stored, { ...stored, id: 2 }],
      ),
    ).toEqual({ status: 'AMBIGUOUS' });
  });

  it('vérifie une boîte ajoutée manuellement comme une boîte scannée', () => {
    const manual = box({ origin: 'MANUAL', scanRaw: null });
    expect(
      verifyPreparationBox('60000001', 14, manual, [manual], '2026-08-03'),
    ).toMatchObject({ status: 'VALID', isFefo: true });
    expect(
      verifyPreparationBox(
        '60000001',
        14,
        { ...manual, expirationDate: '2026-08-02' },
        [manual],
        '2026-08-03',
      ).status,
    ).toBe('EXPIRED');
  });

  it('propose les boîtes du stock du lot FEFO vers les boîtes périmées', () => {
    const expired = box({ id: 1, expirationDate: '2026-08-01' });
    const later = box({ id: 2, expirationDate: '2027-01-01' });
    const soonest = box({ id: 3, expirationDate: '2026-09-01' });
    const other = box({ id: 4, specialtyCis: 'AUTRE' });
    expect(
      listBoxesForMedication(
        '60000001',
        [expired, later, soonest, other],
        '2026-08-03',
      ).map((item) => item.id),
    ).toEqual([3, 2, 1]);
  });

  it('refuse de présenter une sélection manuelle comme une vérification par scan', () => {
    expect(() => assertVerificationEvidence('SCAN', 'raw')).not.toThrow();
    expect(() => assertVerificationEvidence('MANUAL', null)).not.toThrow();
    expect(() => assertVerificationEvidence('SCAN', null)).toThrow('brute');
    expect(() => assertVerificationEvidence('SCAN', '')).toThrow('brute');
    expect(() => assertVerificationEvidence('MANUAL', 'raw')).toThrow('scan');
  });
});
