import {
  asNeededDayState,
  intakesOnLocalDay,
} from '@/domain/intakes/as-needed-availability';
import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';

const NOW = new Date(2026, 8, 2, 14, 0);

function intake(
  takenAt: Date,
  quantityHalfUnits = 2,
  id = 1,
): AsNeededIntakeRecord {
  return {
    id,
    treatmentId: 7,
    takenAt: takenAt.toISOString(),
    quantityHalfUnits,
    note: null,
    createdAt: takenAt.toISOString(),
  };
}

describe('prise si besoin, état du jour', () => {
  it('reste possible sans aucune limite saisie', () => {
    const state = asNeededDayState({
      now: NOW,
      limits: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
      intakesToday: [intake(new Date(2026, 8, 2, 13, 59))],
      lastIntake: intake(new Date(2026, 8, 2, 13, 59)),
    });
    expect(state.availability).toEqual({ status: 'AVAILABLE' });
    expect(state.takenHalfUnits).toBe(2);
    expect(state.intakeCount).toBe(1);
  });

  it('bloque dès que la dose maximale du jour est atteinte', () => {
    const state = asNeededDayState({
      now: NOW,
      limits: { maxQuantityPerDayHalfUnits: 6, minIntervalHours: null },
      intakesToday: [
        intake(new Date(2026, 8, 2, 8, 0), 2, 1),
        intake(new Date(2026, 8, 2, 12, 0), 4, 2),
      ],
      lastIntake: intake(new Date(2026, 8, 2, 12, 0), 4, 2),
    });
    expect(state.availability.status).toBe('MAX_REACHED');
  });

  it('annonce l’heure de la prochaine prise possible', () => {
    const last = intake(new Date(2026, 8, 2, 12, 30));
    const state = asNeededDayState({
      now: NOW,
      limits: { maxQuantityPerDayHalfUnits: null, minIntervalHours: 4 },
      intakesToday: [last],
      lastIntake: last,
    });
    expect(state.availability).toEqual({
      status: 'TOO_SOON',
      nextPossibleAt: new Date(2026, 8, 2, 16, 30).toISOString(),
    });
  });

  it('redevient possible une fois l’intervalle écoulé', () => {
    const last = intake(new Date(2026, 8, 2, 9, 0));
    expect(
      asNeededDayState({
        now: NOW,
        limits: { maxQuantityPerDayHalfUnits: null, minIntervalHours: 4 },
        intakesToday: [last],
        lastIntake: last,
      }).availability,
    ).toEqual({ status: 'AVAILABLE' });
  });

  it('fait primer la dose maximale sur l’intervalle', () => {
    const last = intake(new Date(2026, 8, 2, 13, 30), 4);
    expect(
      asNeededDayState({
        now: NOW,
        limits: { maxQuantityPerDayHalfUnits: 4, minIntervalHours: 6 },
        intakesToday: [last],
        lastIntake: last,
      }).availability.status,
    ).toBe('MAX_REACHED');
  });

  it('ne compte que les prises de la journée civile en cours', () => {
    const today = intake(new Date(2026, 8, 2, 8, 0), 2, 1);
    const yesterday = intake(new Date(2026, 8, 1, 23, 30), 2, 2);
    expect(intakesOnLocalDay([today, yesterday], NOW)).toEqual([today]);
  });
});
