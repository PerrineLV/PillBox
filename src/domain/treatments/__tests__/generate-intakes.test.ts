import { generateIntakes } from '../generate-intakes';
import type { Dosage, Treatment } from '../treatment';

function treatment(dosage: Dosage[]): Treatment {
  return {
    id: 12,
    specialtyCis: '60000001',
    specialtyName: 'Médicament de test',
    pharmaceuticalForm: 'comprimé',
    active: true,
    includedInPillbox: true,
    dosage,
  };
}

describe('generateIntakes', () => {
  it('génère une prise quotidienne', () => {
    const dosage: Dosage[] = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ].map((weekday) => ({
      weekday: weekday as Dosage['weekday'],
      slot: 'morning',
      quantityHalfUnits: 2,
    }));

    expect(
      generateIntakes([treatment(dosage)], '2026-08-03', '2026-08-09'),
    ).toHaveLength(7);
  });

  it('génère matin et soir', () => {
    const result = generateIntakes(
      [
        treatment([
          { weekday: 'monday', slot: 'morning', quantityHalfUnits: 2 },
          { weekday: 'monday', slot: 'evening', quantityHalfUnits: 2 },
        ]),
      ],
      '2026-08-03',
      '2026-08-03',
    );

    expect(result.map((item) => item.slot)).toEqual(['morning', 'evening']);
  });

  it('respecte lundi, mercredi et vendredi', () => {
    const result = generateIntakes(
      [
        treatment(
          ['monday', 'wednesday', 'friday'].map((weekday) => ({
            weekday: weekday as Dosage['weekday'],
            slot: 'noon',
            quantityHalfUnits: 2,
          })),
        ),
      ],
      '2026-08-03',
      '2026-08-09',
    );

    expect(result.map((item) => item.date)).toEqual([
      '2026-08-03',
      '2026-08-05',
      '2026-08-07',
    ]);
  });

  it('conserve exactement les demi-comprimés et 1,5 comprimé', () => {
    const result = generateIntakes(
      [
        treatment([
          { weekday: 'monday', slot: 'morning', quantityHalfUnits: 1 },
          { weekday: 'monday', slot: 'bedtime', quantityHalfUnits: 3 },
        ]),
      ],
      '2026-08-03',
      '2026-08-03',
    );

    expect(result.map((item) => item.quantityHalfUnits)).toEqual([1, 3]);
  });

  it('ignore les traitements inactifs ou exclus du pilulier', () => {
    const base = treatment([
      { weekday: 'monday', slot: 'morning', quantityHalfUnits: 2 },
    ]);
    expect(
      generateIntakes(
        [
          { ...base, active: false },
          { ...base, id: 13, includedInPillbox: false },
        ],
        '2026-08-03',
        '2026-08-03',
      ),
    ).toEqual([]);
  });
});
