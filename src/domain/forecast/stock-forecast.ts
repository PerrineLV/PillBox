import { isExpired, type MedicationBox } from '@/domain/inventory/inventory';
import {
  generatePreparationSnapshot,
  preparationEndDate,
  preparationStartDate,
  PREPARATION_DURATION_DAYS,
  type KnownPreparation,
} from '@/domain/preparations/preparation';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import type { Treatment } from '@/domain/treatments/treatment';

/**
 * Deux cycles de préparation, comptés à partir du premier jour que le pilulier
 * ne couvre pas encore. La prévision ne cherche donc que les ruptures sur
 * lesquelles il reste quelque chose à faire avant les deux prochaines
 * préparations. Une date plus lointaine reposerait sur des phases ouvertes et
 * noierait l'information utile : elle relève du suivi de renouvellement.
 */
export const FORECAST_HORIZON_DAYS = PREPARATION_DURATION_DAYS * 2;

/**
 * Ce que le stock couvre à partir de la date de départ de la prévision.
 * `coveredDays` n'existe que lorsqu'une rupture a réellement été trouvée : hors
 * de ce cas, aucun nombre de jours n'est exposé plutôt que d'en estimer un.
 */
export type ForecastCoverage =
  | Readonly<{
      status: 'RUNS_OUT';
      date: string;
      /** `EXPIRED` lorsque la péremption d'un lot, et non la consommation, provoque le manque. */
      cause: 'CONSUMED' | 'EXPIRED';
      coveredDays: number;
    }>
  | Readonly<{ status: 'BEYOND_HORIZON'; horizonDays: number }>
  | Readonly<{ status: 'NO_FUTURE_INTAKE' }>;

export type MedicationForecast = Readonly<{
  specialtyCis: string;
  specialtyName: string;
  /** Stock utilisable à la date de départ de la prévision, en demi-unités. */
  availableHalfUnits: number;
  /** Besoin des sept jours de la prochaine préparation, en demi-unités. */
  nextPreparationHalfUnits: number;
  missingHalfUnits: number;
  insufficientForNextPreparation: boolean;
  coverage: ForecastCoverage;
}>;

export type StockForecast = Readonly<{
  /** Premier jour non encore couvert par une préparation validée. */
  startDate: string;
  /** Dernier jour de la prochaine préparation de sept jours. */
  endDate: string;
  horizonDays: number;
  horizonEndDate: string;
  medications: readonly MedicationForecast[];
}>;

/**
 * Premier jour dont la consommation reste à couvrir par le stock. Les semaines
 * déjà validées ont retiré leurs comprimés du stock et les ont placés dans le
 * pilulier : les recompter réserverait deux fois la même quantité.
 */
export function forecastStartDate(
  referenceDate: string,
  preparations: readonly KnownPreparation[],
): string {
  const nextFreeDay = preparationStartDate(referenceDate);
  return preparations
    .filter((preparation) => preparation.status === 'COMPLETED')
    .map((preparation) =>
      addCivilDays(preparationEndDate(preparation.startDate), 1),
    )
    .reduce(
      (latest, candidate) => (candidate > latest ? candidate : latest),
      nextFreeDay,
    );
}

export function buildStockForecast(
  treatments: readonly Treatment[],
  boxes: readonly MedicationBox[],
  referenceDate: string,
  preparations: readonly KnownPreparation[],
  options: Readonly<{ horizonDays?: number }> = {},
): StockForecast {
  const horizonDays = options.horizonDays ?? FORECAST_HORIZON_DAYS;
  if (!Number.isSafeInteger(horizonDays) || horizonDays < 1) {
    throw new Error('L’horizon de prévision doit couvrir au moins un jour.');
  }

  const startDate = forecastStartDate(referenceDate, preparations);
  const horizonEndDate = addCivilDays(startDate, horizonDays - 1);
  const snapshot = generatePreparationSnapshot(
    treatments,
    boxes,
    startDate,
    startDate,
  );
  const requirements = new Map(
    snapshot.requirements.map((requirement) => [
      requirement.specialtyCis,
      requirement,
    ]),
  );
  const dailyNeeds = aggregateDailyNeeds(treatments, startDate, horizonEndDate);
  const stock = groupUsableBoxes(boxes, startDate);

  const names = new Map<string, string>();
  for (const box of boxes) names.set(box.specialtyCis, box.specialtyName);
  for (const requirement of snapshot.requirements)
    names.set(requirement.specialtyCis, requirement.specialtyName);
  for (const [specialtyCis, needs] of dailyNeeds)
    if (!names.has(specialtyCis)) names.set(specialtyCis, needs.specialtyName);

  const medications = [...names.entries()]
    .map(([specialtyCis, specialtyName]): MedicationForecast => {
      const lots = stock.get(specialtyCis) ?? [];
      const availableHalfUnits = lots.reduce(
        (total, lot) => total + lot.remainingHalfUnits,
        0,
      );
      const nextPreparationHalfUnits =
        requirements.get(specialtyCis)?.requiredHalfUnits ?? 0;
      const missingHalfUnits = Math.max(
        0,
        nextPreparationHalfUnits - availableHalfUnits,
      );
      return Object.freeze({
        specialtyCis,
        specialtyName,
        availableHalfUnits,
        nextPreparationHalfUnits,
        missingHalfUnits,
        insufficientForNextPreparation: missingHalfUnits > 0,
        coverage: simulateCoverage(
          lots,
          dailyNeeds.get(specialtyCis)?.byDate ?? new Map(),
          startDate,
          horizonDays,
        ),
      });
    })
    .sort((left, right) =>
      left.specialtyName.localeCompare(right.specialtyName),
    );

  return Object.freeze({
    startDate,
    endDate: snapshot.endDate,
    horizonDays,
    horizonEndDate,
    medications: Object.freeze(medications),
  });
}

type SimulatedLot = { expirationDate: string; remainingHalfUnits: number };

type DailyNeeds = { specialtyName: string; byDate: Map<string, number> };

/**
 * Consomme le stock jour après jour, en FEFO comme la préparation le
 * recommande, et retire le reliquat d'un lot le jour où il périme. Aucune
 * quantité n'est arrondie : tout est compté en demi-unités entières.
 */
function simulateCoverage(
  lots: readonly SimulatedLot[],
  needsByDate: ReadonlyMap<string, number>,
  startDate: string,
  horizonDays: number,
): ForecastCoverage {
  if (needsByDate.size === 0)
    return Object.freeze({ status: 'NO_FUTURE_INTAKE' });

  const remaining = lots.map((lot) => ({ ...lot }));
  let lostToExpirationHalfUnits = 0;

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addCivilDays(startDate, offset);
    for (const lot of remaining) {
      if (lot.remainingHalfUnits > 0 && isExpired(lot.expirationDate, date)) {
        lostToExpirationHalfUnits += lot.remainingHalfUnits;
        lot.remainingHalfUnits = 0;
      }
    }

    let need = needsByDate.get(date) ?? 0;
    if (need === 0) continue;

    const available = remaining.reduce(
      (total, lot) => total + lot.remainingHalfUnits,
      0,
    );
    if (available < need) {
      return Object.freeze({
        status: 'RUNS_OUT',
        date,
        cause:
          lostToExpirationHalfUnits > 0 &&
          available + lostToExpirationHalfUnits >= need
            ? 'EXPIRED'
            : 'CONSUMED',
        coveredDays: offset,
      });
    }
    for (const lot of remaining) {
      if (need === 0) break;
      const taken = Math.min(lot.remainingHalfUnits, need);
      lot.remainingHalfUnits -= taken;
      need -= taken;
    }
  }

  return Object.freeze({ status: 'BEYOND_HORIZON', horizonDays });
}

/** Besoin quotidien par médicament, calculé une seule fois sur tout l'horizon. */
function aggregateDailyNeeds(
  treatments: readonly Treatment[],
  startDate: string,
  endDate: string,
): Map<string, DailyNeeds> {
  const needs = new Map<string, DailyNeeds>();
  for (const intake of generateIntakes(treatments, startDate, endDate)) {
    const medication = needs.get(intake.specialtyCis) ?? {
      specialtyName: intake.specialtyName,
      byDate: new Map<string, number>(),
    };
    medication.byDate.set(
      intake.date,
      (medication.byDate.get(intake.date) ?? 0) + intake.quantityHalfUnits,
    );
    needs.set(intake.specialtyCis, medication);
  }
  return needs;
}

/** Lots utilisables à la date de départ, triés du plus proche péremption (FEFO). */
function groupUsableBoxes(
  boxes: readonly MedicationBox[],
  startDate: string,
): Map<string, SimulatedLot[]> {
  const stock = new Map<string, SimulatedLot[]>();
  for (const box of boxes) {
    if (box.remainingQuantity <= 0) continue;
    if (isExpired(box.expirationDate, startDate)) continue;
    const lots = stock.get(box.specialtyCis) ?? [];
    lots.push({
      expirationDate: box.expirationDate,
      remainingHalfUnits: box.remainingQuantity * 2,
    });
    stock.set(box.specialtyCis, lots);
  }
  for (const lots of stock.values())
    lots.sort((left, right) =>
      left.expirationDate.localeCompare(right.expirationDate),
    );
  return stock;
}

function addCivilDays(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Date invalide.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
