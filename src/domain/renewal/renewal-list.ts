import type {
  MedicationForecast,
  StockForecast,
} from '@/domain/forecast/stock-forecast';

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
}>;

const URGENCY_ORDER: Record<RenewalUrgency, number> = {
  INSUFFICIENT_FOR_NEXT_PREPARATION: 0,
  RUNS_OUT_SOON: 1,
  LOW_STOCK: 2,
};

/**
 * Construit la liste des médicaments à renouveler à partir de la seule
 * prévision de stock, classés par urgence puis, à urgence égale, par
 * proximité de rupture ou par quantité manquante.
 */
export function buildRenewalList(
  forecast: StockForecast,
): readonly RenewalItem[] {
  return forecast.medications
    .map((medication) => classify(medication, forecast.endDate))
    .filter((item): item is RenewalItem => item !== null)
    .slice()
    .sort(compareItems);
}

function classify(
  medication: MedicationForecast,
  nextPreparationEndDate: string,
): RenewalItem | null {
  if (medication.insufficientForNextPreparation) {
    return toRenewalItem(medication, 'INSUFFICIENT_FOR_NEXT_PREPARATION');
  }
  if (medication.coverage.status === 'RUNS_OUT') {
    const urgency =
      medication.coverage.date <= nextPreparationEndDate
        ? 'RUNS_OUT_SOON'
        : 'LOW_STOCK';
    return toRenewalItem(medication, urgency);
  }
  return null;
}

function toRenewalItem(
  medication: MedicationForecast,
  urgency: RenewalUrgency,
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
