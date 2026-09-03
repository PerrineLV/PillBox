import {
  asNeededDayState,
  type AsNeededDayState,
} from '@/domain/intakes/as-needed-availability';
import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';
import {
  formatHalfUnits,
  type AsNeededInfo,
} from '@/domain/treatments/treatment';

export type AsNeededSectionInput = Readonly<{
  treatmentId: number;
  specialtyName: string;
  limits: AsNeededInfo;
  /** Prises de la journée civile en cours, déjà restreintes à ce traitement. */
  intakesToday: readonly AsNeededIntakeRecord[];
  /** Peut dater d'hier : l'intervalle minimal traverse le passage de minuit. */
  lastIntake: AsNeededIntakeRecord | null;
}>;

/**
 * Rang de tri de la section « si besoin » de l'accueil.
 *
 * 0 — un épisode est en cours : une prise a déjà eu lieu aujourd'hui et une
 * autre est possible, c'est le cas le plus probable.
 * 1 — disponible, mais rien encore aujourd'hui.
 * 2 — bloqué par une limite saisie par l'utilisatrice : il n'y a rien à faire,
 * la ligne descend.
 */
export type AsNeededRank = 0 | 1 | 2;

export type AsNeededRow = Readonly<{
  treatmentId: number;
  specialtyName: string;
  rank: AsNeededRank;
  /** Vrai lorsqu'une limite empêche d'enregistrer une prise maintenant. */
  blocked: boolean;
  detail: string;
}>;

/**
 * Classe les traitements « si besoin » actifs pour l'accueil. Aucune limite
 * n'est déduite : sans maximum ni intervalle saisis, la prise reste toujours
 * possible et la ligne n'affiche aucun plafond.
 *
 * Le compteur affiché est un plafond de sécurité, jamais un objectif : il
 * n'est comparé à rien et ne doit alerter d'aucune manière à l'approche du
 * maximum.
 */
export function buildAsNeededRows(
  treatments: readonly AsNeededSectionInput[],
  now: Date,
): AsNeededRow[] {
  return treatments
    .map((treatment) => toRow(treatment, now))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.specialtyName.localeCompare(right.specialtyName, 'fr-FR'),
    );
}

function toRow(treatment: AsNeededSectionInput, now: Date): AsNeededRow {
  const state = asNeededDayState({
    now,
    limits: treatment.limits,
    intakesToday: treatment.intakesToday,
    lastIntake: treatment.lastIntake,
  });
  const blocked = state.availability.status !== 'AVAILABLE';
  return {
    treatmentId: treatment.treatmentId,
    specialtyName: treatment.specialtyName,
    rank: blocked ? 2 : state.intakeCount > 0 ? 0 : 1,
    blocked,
    detail: detailLabel(treatment.limits, state),
  };
}

/** Une seule phrase par ligne : l'état, et rien d'autre. */
function detailLabel(limits: AsNeededInfo, state: AsNeededDayState): string {
  const max = limits.maxQuantityPerDayHalfUnits;
  const consumed =
    max === null
      ? null
      : `${formatHalfUnits(state.takenHalfUnits)} sur ${formatHalfUnits(max)}`;
  switch (state.availability.status) {
    case 'MAX_REACHED':
      return join(['Maximum du jour atteint', consumed]);
    case 'TOO_SOON':
      return join([
        `Prochaine possible à ${formatLocalTime(state.availability.nextPossibleAt)}`,
        consumed,
      ]);
    case 'AVAILABLE':
      if (state.intakeCount === 0) return 'Aucune prise aujourd’hui';
      return join([
        `${state.intakeCount} prise${state.intakeCount > 1 ? 's' : ''} aujourd’hui`,
        max === null
          ? null
          : `${formatHalfUnits(max - state.takenHalfUnits)} restante(s)`,
      ]);
  }
}

function join(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ');
}

/**
 * Formaté depuis l'heure locale plutôt que par `toLocaleTimeString` : le
 * libellé doit être identique quel que soit l'environnement d'exécution.
 */
function formatLocalTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
