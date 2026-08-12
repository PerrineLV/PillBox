import {
  buildAttachedSpecialtyCisSet,
  isOrphanBox,
  isTreatmentWithoutStock,
} from '../box-attachment';
import type { MedicationBox } from '../inventory';
import type { Treatment } from '@/domain/treatments/treatment';

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    dosageKind: 'SCHEDULED',
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
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    ...overrides,
  };
}

function box(overrides: Partial<MedicationBox> = {}): MedicationBox {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    presentationCip13: '3400000000001',
    presentationLabel: 'Boîte',
    lot: 'LOT-A',
    expirationDate: '2027-01-01',
    initialQuantity: 30,
    remainingQuantity: 30,
    origin: 'SCAN',
    scanRaw: 'raw',
    ...overrides,
  };
}

describe('rattachement d’une boîte à un traitement actif', () => {
  it('rattache une boîte dont le CIS correspond exactement à un traitement actif', () => {
    const attached = buildAttachedSpecialtyCisSet([treatment()], []);
    expect(isOrphanBox(box({ specialtyCis: '60000001' }), attached)).toBe(
      false,
    );
  });

  it('signale comme orpheline une boîte sans aucune correspondance', () => {
    const attached = buildAttachedSpecialtyCisSet([treatment()], []);
    expect(isOrphanBox(box({ specialtyCis: '60000099' }), attached)).toBe(true);
  });

  it('rattache une boîte via une équivalence générique mémorisée pour un traitement actif', () => {
    const attached = buildAttachedSpecialtyCisSet(
      [treatment({ id: 1, specialtyCis: '60000001' })],
      [{ treatmentId: 1, cis: '60000002' }],
    );
    expect(isOrphanBox(box({ specialtyCis: '60000002' }), attached)).toBe(
      false,
    );
  });

  it('ne rattache jamais une boîte via une équivalence confirmée pour un autre traitement', () => {
    const attached = buildAttachedSpecialtyCisSet(
      [treatment({ id: 1, specialtyCis: '60000001' })],
      [{ treatmentId: 99, cis: '60000002' }],
    );
    expect(isOrphanBox(box({ specialtyCis: '60000002' }), attached)).toBe(true);
  });

  it('cesse de rattacher une boîte dont le traitement a été archivé', () => {
    const attached = buildAttachedSpecialtyCisSet(
      [treatment({ archivedAt: '2026-08-12T00:00:00.000Z' })],
      [],
    );
    expect(isOrphanBox(box({ specialtyCis: '60000001' }), attached)).toBe(true);
  });

  it('cesse de rattacher une boîte dont l’équivalence a été oubliée', () => {
    const attachedBefore = buildAttachedSpecialtyCisSet(
      [treatment({ id: 1, specialtyCis: '60000001' })],
      [{ treatmentId: 1, cis: '60000002' }],
    );
    const attachedAfter = buildAttachedSpecialtyCisSet(
      [treatment({ id: 1, specialtyCis: '60000001' })],
      [],
    );
    expect(isOrphanBox(box({ specialtyCis: '60000002' }), attachedBefore)).toBe(
      false,
    );
    expect(isOrphanBox(box({ specialtyCis: '60000002' }), attachedAfter)).toBe(
      true,
    );
  });

  it('rattache de nouveau une boîte dès qu’un traitement actif correspondant est créé', () => {
    const attachedBefore = buildAttachedSpecialtyCisSet([], []);
    const attachedAfter = buildAttachedSpecialtyCisSet(
      [treatment({ specialtyCis: '60000001' })],
      [],
    );
    expect(isOrphanBox(box({ specialtyCis: '60000001' }), attachedBefore)).toBe(
      true,
    );
    expect(isOrphanBox(box({ specialtyCis: '60000001' }), attachedAfter)).toBe(
      false,
    );
  });
});

describe('absence de boîte en stock pour un traitement (ticket 29)', () => {
  it('signale l’absence de boîte quand aucune ne correspond au CIS du traitement', () => {
    expect(isTreatmentWithoutStock('60000001', 1, [], [])).toBe(true);
  });

  it('ne signale rien dès qu’une boîte porte le CIS exact du traitement', () => {
    expect(
      isTreatmentWithoutStock(
        '60000001',
        1,
        [box({ specialtyCis: '60000001' })],
        [],
      ),
    ).toBe(false);
  });

  it('ne signale rien quand une boîte correspond via une équivalence générique mémorisée pour ce traitement précis', () => {
    expect(
      isTreatmentWithoutStock(
        '60000001',
        1,
        [box({ specialtyCis: '60000002' })],
        [{ treatmentId: 1, cis: '60000002' }],
      ),
    ).toBe(false);
  });

  it('ignore une équivalence mémorisée pour un autre traitement', () => {
    expect(
      isTreatmentWithoutStock(
        '60000001',
        1,
        [box({ specialtyCis: '60000002' })],
        [{ treatmentId: 99, cis: '60000002' }],
      ),
    ).toBe(true);
  });

  it('n’utilise jamais d’équivalence pour un traitement pas encore enregistré (treatmentId null)', () => {
    expect(
      isTreatmentWithoutStock(
        '60000001',
        null,
        [box({ specialtyCis: '60000002' })],
        [{ treatmentId: 1, cis: '60000002' }],
      ),
    ).toBe(true);
  });

  it('reste sans boîte pour un traitement nouvellement créé sans équivalence, mais couvert dès qu’une boîte au CIS exact existe', () => {
    expect(isTreatmentWithoutStock('60000001', null, [], [])).toBe(true);
    expect(
      isTreatmentWithoutStock(
        '60000001',
        null,
        [box({ specialtyCis: '60000001' })],
        [],
      ),
    ).toBe(false);
  });

  it('couvre un traitement pas encore enregistré dès qu’une équivalence vient d’être confirmée, même en attente d’écriture en base', () => {
    expect(
      isTreatmentWithoutStock(
        '60000001',
        null,
        [box({ specialtyCis: '60000002' })],
        [],
        ['60000002'],
      ),
    ).toBe(false);
  });

  it('ignore une équivalence en attente pour un CIS qu’aucune boîte du stock ne porte réellement', () => {
    expect(
      isTreatmentWithoutStock('60000001', null, [], [], ['60000002']),
    ).toBe(true);
  });
});
