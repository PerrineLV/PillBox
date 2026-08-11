import type { AsNeededIntakeRecord } from '../as-needed-intake';
import {
  groupAsNeededIntakesByPeriod,
  groupIntakesByPeriod,
  recordedTakenRatio,
} from '../intake-statistics';
import {
  intakeRecordKey,
  type IntakeRecord,
  type IntakeStatus,
} from '../intake-tracking';

function record(
  treatmentId: number,
  date: string,
  status: IntakeStatus,
  overrides: Partial<IntakeRecord> = {},
): IntakeRecord {
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
    createdAt: `${date} 06:00:00`,
    updatedAt: `${date} 06:00:00`,
    ...overrides,
  };
}

function asNeeded(
  treatmentId: number,
  takenAt: string,
  overrides: Partial<AsNeededIntakeRecord> = {},
): AsNeededIntakeRecord {
  return {
    id: overrides.id ?? Math.round(Math.random() * 1_000_000),
    treatmentId,
    takenAt,
    quantityHalfUnits: 2,
    note: null,
    createdAt: takenAt,
    ...overrides,
  };
}

describe('groupIntakesByPeriod — regroupement hebdomadaire', () => {
  it('compte séparément les trois statuts, sans jamais confondre non renseigné et ignoré', () => {
    const records = [
      // Semaine du lundi 10 août 2026 au dimanche 16 août 2026.
      record(1, '2026-08-10', 'TAKEN'),
      record(1, '2026-08-11', 'SKIPPED'),
      record(1, '2026-08-12', 'UNSET'),
      record(2, '2026-08-13', 'TAKEN'),
    ];

    const [week] = groupIntakesByPeriod(records, 'week');

    expect(week).toMatchObject({
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      scheduledCount: 4,
      takenCount: 2,
      skippedCount: 1,
      unsetCount: 1,
    });
  });

  it('répartit les prises dans des semaines distinctes de part et d’autre d’un lundi', () => {
    const records = [
      record(1, '2026-08-09', 'TAKEN'), // dimanche : semaine du 3 au 9 août
      record(1, '2026-08-10', 'TAKEN'), // lundi : semaine du 10 au 16 août
    ];

    const periods = groupIntakesByPeriod(records, 'week');

    expect(periods).toHaveLength(2);
    expect(periods.map((period) => period.startDate)).toEqual([
      '2026-08-10',
      '2026-08-03',
    ]);
  });

  it('trie les périodes de la plus récente à la plus ancienne', () => {
    const records = [
      record(1, '2026-07-01', 'TAKEN'),
      record(1, '2026-08-01', 'TAKEN'),
    ];

    const periods = groupIntakesByPeriod(records, 'month');

    expect(periods.map((period) => period.periodKey)).toEqual([
      '2026-08',
      '2026-07',
    ]);
  });
});

describe('groupIntakesByPeriod — regroupement mensuel', () => {
  it('couvre l’intégralité du mois civil, y compris à cheval sur deux années', () => {
    const records = [record(1, '2025-12-31', 'TAKEN')];

    const [month] = groupIntakesByPeriod(records, 'month');

    expect(month).toMatchObject({
      periodKey: '2025-12',
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      scheduledCount: 1,
    });
  });
});

describe('groupAsNeededIntakesByPeriod', () => {
  it('compte les prises ponctuelles par période sans notion de prise prévue', () => {
    const records = [
      asNeeded(1, '2026-08-10T12:00:00.000Z'),
      asNeeded(1, '2026-08-12T12:00:00.000Z'),
      asNeeded(2, '2026-07-01T12:00:00.000Z'),
    ];

    const periods = groupAsNeededIntakesByPeriod(records, 'month');

    expect(periods).toEqual([
      {
        periodKey: '2026-08',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        recordedCount: 2,
      },
      {
        periodKey: '2026-07',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        recordedCount: 1,
      },
    ]);
  });
});

describe('recordedTakenRatio', () => {
  it('divise les prises enregistrées comme prises par les prises prévues', () => {
    expect(
      recordedTakenRatio({ scheduledCount: 4, takenCount: 1 }),
    ).toBeCloseTo(0.25);
  });

  it('ne retourne aucun ratio lorsqu’aucune prise n’était prévue', () => {
    expect(recordedTakenRatio({ scheduledCount: 0, takenCount: 0 })).toBeNull();
  });

  it('ne compte jamais une prise non renseignée comme une prise', () => {
    const ratio = recordedTakenRatio({ scheduledCount: 3, takenCount: 1 });
    // scheduledCount = pris + ignoré + non renseigné = 1 + 1 + 1 : le ratio ne
    // porte que sur le numérateur explicite `takenCount`.
    expect(ratio).toBeCloseTo(1 / 3);
  });
});
