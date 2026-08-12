import type {
  MedicationForecast,
  StockForecast,
} from '@/domain/forecast/stock-forecast';
import type { Treatment } from '@/domain/treatments/treatment';

/**
 * Ordonnées de la plus urgente à la moins urgente. `RUNS_OUT_SOON` désigne une
 * rupture prévue avant la fin de la prochaine préparation ; `LOW_STOCK` une
 * rupture plus lointaine mais toujours dans l'horizon de la prévision.
 */
export const RENEWAL_URGENCIES = [
  'INSUFFICIENT_FOR_NEXT_PREPARATION',
  'RUNS_OUT_SOON',
  'LOW_STOCK',
] as const;

export type RenewalUrgency = (typeof RENEWAL_URGENCIES)[number];

export type RenewalItem = Readonly<{
  specialtyCis: string;
  specialtyName: string;
  urgency: RenewalUrgency;
  availableHalfUnits: number;
  nextPreparationHalfUnits: number;
  missingHalfUnits: number;
  /** `null` lorsque la prévision n'a pas trouvé de date de rupture exploitable. */
  ruptureDate: string | null;
  ruptureCause: 'CONSUMED' | 'EXPIRED' | null;
  /**
   * Renouvellement théorique d'une délivrance encadrée (ticket 30), purement
   * informatif. `null` en l'absence de traitement concerné : n'influence
   * jamais l'urgence ni le tri, calculés uniquement depuis le stock réel.
   */
  theoreticalRenewalDate: string | null;
}>;

const URGENCY_ORDER: Record<RenewalUrgency, number> = {
  INSUFFICIENT_FOR_NEXT_PREPARATION: 0,
  RUNS_OUT_SOON: 1,
  LOW_STOCK: 2,
};

/**
 * Construit la liste des médicaments à renouveler à partir de la seule
 * prévision de stock, classés par urgence puis, à urgence égale, par
 * proximité de rupture ou par quantité manquante. `treatments` ne sert qu'à
 * joindre, à titre indicatif, la date de renouvellement théorique d'une
 * délivrance encadrée (ticket 30) : elle n'intervient jamais dans le calcul
 * de l'urgence ni dans le tri.
 */
export function buildRenewalList(
  forecast: StockForecast,
  treatments: readonly Treatment[] = [],
): readonly RenewalItem[] {
  const theoreticalRenewalDates = buildTheoreticalRenewalDateIndex(treatments);
  return forecast.medications
    .map((medication) =>
      classify(medication, forecast.endDate, theoreticalRenewalDates),
    )
    .filter((item): item is RenewalItem => item !== null)
    .slice()
    .sort(compareItems);
}

/**
 * Une spécialité n'a normalement qu'un traitement actif : en cas d'homonymie
 * inattendue, la première date de renouvellement théorique activée trouvée
 * est retenue, sans en privilégier une autre — purement informatif.
 */
function buildTheoreticalRenewalDateIndex(
  treatments: readonly Treatment[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const treatment of treatments) {
    const info = treatment.controlledDispensing;
    if (
      info === null ||
      !info.enabled ||
      info.theoreticalRenewalDate === null ||
      index.has(treatment.specialtyCis)
    )
      continue;
    index.set(treatment.specialtyCis, info.theoreticalRenewalDate);
  }
  return index;
}

function classify(
  medication: MedicationForecast,
  nextPreparationEndDate: string,
  theoreticalRenewalDates: ReadonlyMap<string, string>,
): RenewalItem | null {
  if (medication.insufficientForNextPreparation) {
    return toRenewalItem(
      medication,
      'INSUFFICIENT_FOR_NEXT_PREPARATION',
      theoreticalRenewalDates,
    );
  }
  if (medication.coverage.status === 'RUNS_OUT') {
    const urgency =
      medication.coverage.date <= nextPreparationEndDate
        ? 'RUNS_OUT_SOON'
        : 'LOW_STOCK';
    return toRenewalItem(medication, urgency, theoreticalRenewalDates);
  }
  return null;
}

function toRenewalItem(
  medication: MedicationForecast,
  urgency: RenewalUrgency,
  theoreticalRenewalDates: ReadonlyMap<string, string>,
): RenewalItem {
  const coverage = medication.coverage;
  return Object.freeze({
    specialtyCis: medication.specialtyCis,
    specialtyName: medication.specialtyName,
    urgency,
    availableHalfUnits: medication.availableHalfUnits,
    nextPreparationHalfUnits: medication.nextPreparationHalfUnits,
    missingHalfUnits: medication.missingHalfUnits,
    ruptureDate: coverage.status === 'RUNS_OUT' ? coverage.date : null,
    ruptureCause: coverage.status === 'RUNS_OUT' ? coverage.cause : null,
    theoreticalRenewalDate:
      theoreticalRenewalDates.get(medication.specialtyCis) ?? null,
  });
}

function compareItems(left: RenewalItem, right: RenewalItem): number {
  return (
    URGENCY_ORDER[left.urgency] - URGENCY_ORDER[right.urgency] ||
    compareRuptureDates(left.ruptureDate, right.ruptureDate) ||
    right.missingHalfUnits - left.missingHalfUnits ||
    left.specialtyName.localeCompare(right.specialtyName)
  );
}

function compareRuptureDates(
  left: string | null,
  right: string | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}
