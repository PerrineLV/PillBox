import { generateIntakes } from '../generate-intakes';
import {
  assertValidTreatmentPhases,
  type Treatment,
  type TreatmentPhase,
} from '../treatment';

function treatment(phases: TreatmentPhase[]): Treatment {
  return {
    id: 12,
    specialtyCis: '60000001',
    specialtyName: 'Médicament de test',
    pharmaceuticalForm: 'comprimé',
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases,
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
  };
}

function daily(
  startDate: string,
  endDate: string | null,
  quantityHalfUnits = 2,
): TreatmentPhase {
  return {
    id: null,
    startDate,
    endDate,
    frequency: { type: 'daily' },
    dosage: [{ slot: 'morning', quantityHalfUnits }],
  };
}

describe('generateIntakes avec phases', () => {
  it('génère 1 comprimé par jour pendant 14 jours puis 2 comprimés par jour', () => {
    const result = generateIntakes(
      [
        treatment([
          daily('2026-08-01', '2026-08-14'),
          daily('2026-08-15', null, 4),
        ]),
      ],
      '2026-08-01',
      '2026-08-17',
    );
    expect(result).toHaveLength(17);
    expect(
      result.slice(0, 14).every((item) => item.quantityHalfUnits === 2),
    ).toBe(true);
    expect(
      result.slice(14).map((item) => [item.date, item.quantityHalfUnits]),
    ).toEqual([
      ['2026-08-15', 4],
      ['2026-08-16', 4],
      ['2026-08-17', 4],
    ]);
  });

  it('passe exactement de la première phase à la seconde', () => {
    const result = generateIntakes(
      [
        treatment([
          daily('2026-08-01', '2026-08-14'),
          daily('2026-08-15', null, 4),
        ]),
      ],
      '2026-08-14',
      '2026-08-15',
    );
    expect(result.map((item) => [item.date, item.quantityHalfUnits])).toEqual([
      ['2026-08-14', 2],
      ['2026-08-15', 4],
    ]);
  });

  it('génère une prise tous les jours', () => {
    expect(
      generateIntakes(
        [treatment([daily('2026-08-03', null)])],
        '2026-08-03',
        '2026-08-09',
      ),
    ).toHaveLength(7);
  });

  it.each([
    [2, ['2026-08-01', '2026-08-03', '2026-08-05']],
    [3, ['2026-08-01', '2026-08-04']],
  ])(
    'génère une prise tous les %i jours depuis une ancre connue',
    (everyNDays, expected) => {
      const phase: TreatmentPhase = {
        id: null,
        startDate: '2026-08-01',
        endDate: null,
        frequency: { type: 'interval', everyNDays, anchorDate: '2026-08-01' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      };
      expect(
        generateIntakes([treatment([phase])], '2026-08-01', '2026-08-06').map(
          (item) => item.date,
        ),
      ).toEqual(expected);
    },
  );

  it('génère une prise hebdomadaire le jour choisi', () => {
    const phase: TreatmentPhase = {
      id: null,
      startDate: '2026-08-01',
      endDate: null,
      frequency: { type: 'weekly', weekday: 'wednesday' },
      dosage: [{ slot: 'evening', quantityHalfUnits: 2 }],
    };
    expect(
      generateIntakes([treatment([phase])], '2026-08-01', '2026-08-15').map(
        (item) => item.date,
      ),
    ).toEqual(['2026-08-05', '2026-08-12']);
  });

  it('reste déterministe avant et après la date d’ancrage', () => {
    const phase: TreatmentPhase = {
      id: null,
      startDate: '2026-07-01',
      endDate: null,
      frequency: { type: 'interval', everyNDays: 3, anchorDate: '2026-08-04' },
      dosage: [{ slot: 'noon', quantityHalfUnits: 2 }],
    };
    expect(
      generateIntakes([treatment([phase])], '2026-07-29', '2026-08-10').map(
        (item) => item.date,
      ),
    ).toEqual([
      '2026-07-29',
      '2026-08-01',
      '2026-08-04',
      '2026-08-07',
      '2026-08-10',
    ]);
  });

  it('applique une phase ouverte sans date de fin', () => {
    expect(
      generateIntakes(
        [treatment([daily('2026-08-01', null)])],
        '2027-01-01',
        '2027-01-02',
      ),
    ).toHaveLength(2);
  });

  it('rejette deux phases qui se chevauchent', () => {
    expect(() =>
      assertValidTreatmentPhases([
        daily('2026-08-01', '2026-08-14'),
        daily('2026-08-14', null),
      ]),
    ).toThrow('chevaucher');
  });

  it('exige un jour hebdomadaire choisi explicitement', () => {
    const phase: TreatmentPhase = {
      id: null,
      startDate: '2026-08-01',
      endDate: null,
      frequency: { type: 'weekly', weekday: null },
      dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
    };
    expect(() => assertValidTreatmentPhases([phase])).toThrow('explicitement');
  });

  it('conserve les demi-comprimés dans une phase', () => {
    const phase: TreatmentPhase = {
      id: null,
      startDate: '2026-08-03',
      endDate: null,
      frequency: { type: 'daily' },
      dosage: [
        { slot: 'morning', quantityHalfUnits: 1 },
        { slot: 'bedtime', quantityHalfUnits: 3 },
      ],
    };
    expect(
      generateIntakes([treatment([phase])], '2026-08-03', '2026-08-03').map(
        (item) => item.quantityHalfUnits,
      ),
    ).toEqual([1, 3]);
  });

  it('préserve exactement une posologie héritée', () => {
    const legacy: TreatmentPhase = {
      id: 1,
      startDate: null,
      endDate: null,
      frequency: { type: 'legacy-weekdays' },
      dosage: [
        { weekday: 'monday', slot: 'morning', quantityHalfUnits: 1 },
        { weekday: 'wednesday', slot: 'bedtime', quantityHalfUnits: 3 },
      ],
    };
    expect(
      generateIntakes([treatment([legacy])], '2026-08-03', '2026-08-09').map(
        (item) => [item.date, item.slot, item.quantityHalfUnits],
      ),
    ).toEqual([
      ['2026-08-03', 'morning', 1],
      ['2026-08-05', 'bedtime', 3],
    ]);
  });

  it('ignore les traitements archivés ou exclus du pilulier', () => {
    const base = treatment([daily('2026-08-03', null)]);
    expect(
      generateIntakes(
        [
          { ...base, archivedAt: '2026-08-01' },
          { ...base, id: 13, includedInPillbox: false },
        ],
        '2026-08-03',
        '2026-08-03',
      ),
    ).toEqual([]);
  });

  it('ne génère jamais de prise planifiée pour un traitement « si besoin »', () => {
    const asNeeded: Treatment = {
      ...treatment([]),
      dosageKind: 'AS_NEEDED',
      includedInPillbox: false,
    };
    expect(
      generateIntakes([asNeeded], '2026-08-01', '2026-08-31', {
        includeTreatmentsOutsidePillbox: true,
      }),
    ).toEqual([]);
  });
});
