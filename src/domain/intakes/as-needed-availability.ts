import type { AsNeededIntakeRecord } from './as-needed-intake';
import type { AsNeededInfo } from '@/domain/treatments/treatment';

/**
 * Possibilité d'enregistrer une prise « si besoin » maintenant. Les deux
 * limites saisies par l'utilisatrice — dose maximale par jour et intervalle
 * minimal — sont vérifiées séparément : la dose maximale l'emporte, car elle
 * ne se débloque pas au fil des heures.
 *
 * Aucune limite n'est jamais déduite : sans valeur saisie, la prise reste
 * possible.
 */
export type AsNeededAvailability =
  | Readonly<{ status: 'AVAILABLE' }>
  | Readonly<{ status: 'MAX_REACHED' }>
  | Readonly<{ status: 'TOO_SOON'; nextPossibleAt: string }>;

export type AsNeededDayState = Readonly<{
  takenHalfUnits: number;
  intakeCount: number;
  availability: AsNeededAvailability;
}>;

const HOUR_IN_MS = 3_600_000;

export function asNeededDayState({
  now,
  limits,
  intakesToday,
  lastIntake,
}: {
  now: Date;
  limits: AsNeededInfo;
  /** Prises déjà enregistrées pour la journée civile en cours. */
  intakesToday: readonly AsNeededIntakeRecord[];
  lastIntake: AsNeededIntakeRecord | null;
}): AsNeededDayState {
  const takenHalfUnits = intakesToday.reduce(
    (total, intake) => total + intake.quantityHalfUnits,
    0,
  );
  return {
    takenHalfUnits,
    intakeCount: intakesToday.length,
    availability: availabilityOf({ now, limits, takenHalfUnits, lastIntake }),
  };
}

function availabilityOf({
  now,
  limits,
  takenHalfUnits,
  lastIntake,
}: {
  now: Date;
  limits: AsNeededInfo;
  takenHalfUnits: number;
  lastIntake: AsNeededIntakeRecord | null;
}): AsNeededAvailability {
  if (
    limits.maxQuantityPerDayHalfUnits !== null &&
    takenHalfUnits >= limits.maxQuantityPerDayHalfUnits
  )
    return { status: 'MAX_REACHED' };
  if (limits.minIntervalHours === null || lastIntake === null)
    return { status: 'AVAILABLE' };
  const nextPossible = new Date(
    new Date(lastIntake.takenAt).getTime() +
      limits.minIntervalHours * HOUR_IN_MS,
  );
  return nextPossible.getTime() > now.getTime()
    ? { status: 'TOO_SOON', nextPossibleAt: nextPossible.toISOString() }
    : { status: 'AVAILABLE' };
}

/** Prises appartenant à la journée civile locale de `reference`. */
export function intakesOnLocalDay(
  intakes: readonly AsNeededIntakeRecord[],
  reference: Date,
): AsNeededIntakeRecord[] {
  return intakes.filter((intake) =>
    isSameLocalDay(new Date(intake.takenAt), reference),
  );
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
