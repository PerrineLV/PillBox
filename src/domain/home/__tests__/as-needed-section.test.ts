import {
  buildAsNeededRows,
  type AsNeededSectionInput,
} from '../as-needed-section';
import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';

const NOW = new Date(2026, 2, 3, 15, 30);

function intake(
  hour: number,
  quantityHalfUnits = 2,
  id = hour,
): AsNeededIntakeRecord {
  const takenAt = new Date(2026, 2, 3, hour, 0);
  return {
    id,
    treatmentId: 1,
    takenAt: takenAt.toISOString(),
    quantityHalfUnits,
    note: null,
    createdAt: takenAt.toISOString(),
  };
}

function row(overrides: Partial<AsNeededSectionInput>): AsNeededSectionInput {
  return {
    treatmentId: 1,
    specialtyName: 'Doliprane 500 mg',
    limits: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    intakesToday: [],
    lastIntake: null,
    ...overrides,
  };
}

describe('section « si besoin » de l’accueil', () => {
  it('sans limite saisie, la prise reste possible et rien n’est deviné', () => {
    const [first] = buildAsNeededRows([row({})], NOW);
    expect(first.blocked).toBe(false);
    expect(first.rank).toBe(1);
    expect(first.detail).toBe('Aucune prise aujourd’hui');
  });

  it('remonte un traitement déjà pris aujourd’hui et annonce le reste', () => {
    const [first] = buildAsNeededRows(
      [
        row({
          limits: { maxQuantityPerDayHalfUnits: 6, minIntervalHours: null },
          intakesToday: [intake(9), intake(13)],
          lastIntake: intake(13),
        }),
      ],
      NOW,
    );
    expect(first.rank).toBe(0);
    expect(first.detail).toBe('2 prises aujourd’hui · 1 restante(s)');
  });

  it('descend un traitement au maximum du jour et le déclare bloqué', () => {
    const [first] = buildAsNeededRows(
      [
        row({
          limits: { maxQuantityPerDayHalfUnits: 4, minIntervalHours: null },
          intakesToday: [intake(9), intake(13)],
          lastIntake: intake(13),
        }),
      ],
      NOW,
    );
    expect(first.rank).toBe(2);
    expect(first.blocked).toBe(true);
    expect(first.detail).toBe('Maximum du jour atteint · 2 sur 2');
  });

  it('annonce l’heure de la prochaine prise possible quand l’intervalle court', () => {
    const [first] = buildAsNeededRows(
      [
        row({
          limits: { maxQuantityPerDayHalfUnits: null, minIntervalHours: 6 },
          intakesToday: [intake(13)],
          lastIntake: intake(13),
        }),
      ],
      NOW,
    );
    expect(first.rank).toBe(2);
    expect(first.detail).toBe('Prochaine possible à 19:00');
  });

  it('classe par rang puis par nom, sans jamais dépendre du nombre de prises', () => {
    const rows = buildAsNeededRows(
      [
        row({ treatmentId: 1, specialtyName: 'Spasfon' }),
        row({
          treatmentId: 2,
          specialtyName: 'Doliprane 500 mg',
          limits: { maxQuantityPerDayHalfUnits: 2, minIntervalHours: null },
          intakesToday: [intake(9)],
          lastIntake: intake(9),
        }),
        row({ treatmentId: 3, specialtyName: 'Ibuprofène 200 mg' }),
        row({
          treatmentId: 4,
          specialtyName: 'Aspirine 500 mg',
          limits: { maxQuantityPerDayHalfUnits: 8, minIntervalHours: null },
          intakesToday: [intake(11)],
          lastIntake: intake(11),
        }),
      ],
      NOW,
    );
    expect(rows.map((entry) => entry.treatmentId)).toEqual([4, 3, 1, 2]);
  });
});
