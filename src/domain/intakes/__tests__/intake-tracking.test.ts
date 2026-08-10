import {
  canValidateWholeGroup,
  intakeRecordKey,
  pendingIntakesOfGroup,
  type IntakeRecord,
  type IntakeStatus,
} from '../intake-tracking';

function record(
  treatmentId: number,
  status: IntakeStatus,
  overrides: Partial<IntakeRecord> = {},
): IntakeRecord {
  const date = overrides.date ?? '2026-08-10';
  const slot = overrides.slot ?? 'morning';
  return {
    key: intakeRecordKey(treatmentId, date, slot),
    treatmentId,
    date,
    slot,
    specialtyCis: `cis-${treatmentId}`,
    specialtyName: `Médicament ${treatmentId}`,
    pharmaceuticalForm: 'comprimé',
    quantityHalfUnits: 2,
    status,
    createdAt: '2026-08-10 06:00:00',
    updatedAt: '2026-08-10 06:00:00',
    ...overrides,
  };
}
const MORNING = { date: '2026-08-10', slot: 'morning' } as const;

describe('validation groupée d’un temps de prise', () => {
  it('ne retient que les prises non renseignées du créneau visé', () => {
    const records = [
      record(1, 'UNSET'),
      record(2, 'TAKEN'),
      record(3, 'SKIPPED'),
      record(4, 'UNSET', { slot: 'noon' }),
      record(5, 'UNSET', { date: '2026-08-11' }),
    ];

    expect(
      pendingIntakesOfGroup(records, MORNING).map((item) => item.treatmentId),
    ).toEqual([1]);
  });

  it('propose l’action globale seulement à partir de deux prises en attente', () => {
    expect(canValidateWholeGroup([], MORNING)).toBe(false);
    expect(
      canValidateWholeGroup([record(1, 'UNSET'), record(2, 'TAKEN')], MORNING),
    ).toBe(false);
    expect(
      canValidateWholeGroup(
        [record(1, 'UNSET'), record(2, 'UNSET'), record(3, 'TAKEN')],
        MORNING,
      ),
    ).toBe(true);
  });

  it('ne propose pas l’action globale quand tout est déjà renseigné', () => {
    expect(
      canValidateWholeGroup(
        [record(1, 'TAKEN'), record(2, 'SKIPPED'), record(3, 'TAKEN')],
        MORNING,
      ),
    ).toBe(false);
  });
});
