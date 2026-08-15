import type {
  MedicationForecast,
  StockForecast,
} from '@/domain/forecast/stock-forecast';
import {
  usableQuantity,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import {
  theoreticalRenewalWindow,
  type PrescriptionItem,
  type PrescriptionItemQuantityKind,
  type TheoreticalRenewalWindow,
} from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';

/**
 * En dessous ou à ce nombre de boîtes utilisables, une ligne FRACTIONAL en
 * BOX_COUNT (typiquement AS_NEEDED) est signalée : simple seuil informatif,
 * sans lien avec une règle pharmaceutique.
 */
const LOW_BOX_COUNT_THRESHOLD = 1;

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
   * Renouvellement théorique d'une ligne d'ordonnance FRACTIONAL (tickets 30
   * puis 47), purement informatif. `null` en l'absence de ligne concernée :
   * n'influence jamais l'urgence ni le tri, calculés uniquement depuis le
   * stock réel.
   */
  theoreticalRenewalDate: string | null;
  /**
   * Fenêtre de délivrance possible autour de `theoreticalRenewalDate`,
   * tolérance incluse (`start === end` sans tolérance, ex. stupéfiants).
   * `null` sans date théorique.
   */
  theoreticalRenewalWindow: TheoreticalRenewalWindow | null;
  /**
   * `true` quand la rupture prévue (`ruptureDate`) tombe avant le début de la
   * fenêtre de renouvellement : « tu vas être à sec avant de pouvoir
   * renouveler ». Toujours `false` sans rupture ou sans date théorique.
   */
  runsOutBeforeRenewalWindow: boolean;
  /**
   * Nombre de boîtes utilisables en stock, uniquement pour une ligne
   * FRACTIONAL en BOX_COUNT (typiquement AS_NEEDED) : la notion de
   * consommation régulière de `buildStockForecast` n'a pas de sens dans ce
   * cas. `null` pour un médicament classé depuis la prévision de stock
   * habituelle.
   */
  usableBoxCount: number | null;
}>;

const URGENCY_ORDER: Record<RenewalUrgency, number> = {
  INSUFFICIENT_FOR_NEXT_PREPARATION: 0,
  RUNS_OUT_SOON: 1,
  LOW_STOCK: 2,
};

/**
 * Construit la liste des médicaments à renouveler, classés par urgence puis,
 * à urgence égale, par proximité de rupture ou par quantité manquante.
 * `treatments` et `prescriptionItems` servent à joindre, à titre indicatif,
 * le renouvellement théorique d'une ligne d'ordonnance en mode `FRACTIONAL`
 * (tickets 45 et 47) : ils n'interviennent jamais dans le calcul de
 * l'urgence ni dans le tri, qui restent basés exclusivement sur le stock
 * réel — la prévision de consommation (`forecast`) pour les lignes en
 * `DURATION`, le nombre de boîtes utilisables (`boxes`) pour les lignes en
 * `BOX_COUNT`, typiquement des traitements `AS_NEEDED` que `buildStockForecast`
 * exclut faute de prise future régulière. `today` ne sert qu'à cette
 * dernière vérification ; par défaut la date de départ de la prévision.
 */
export function buildRenewalList(
  forecast: StockForecast,
  treatments: readonly Treatment[] = [],
  prescriptionItems: readonly PrescriptionItem[] = [],
  boxes: readonly MedicationBox[] = [],
  today: string = forecast.startDate,
): readonly RenewalItem[] {
  const renewalInfo = indexPrescriptionRenewalInfo(
    treatments,
    prescriptionItems,
  );
  const boxCountCis = new Set(
    [...renewalInfo.entries()]
      .filter(([, info]) => info.quantityKind === 'BOX_COUNT')
      .map(([specialtyCis]) => specialtyCis),
  );

  const consumptionItems = forecast.medications
    .filter((medication) => !boxCountCis.has(medication.specialtyCis))
    .map((medication) => classify(medication, forecast.endDate, renewalInfo))
    .filter((item): item is RenewalItem => item !== null);

  const boxCountItems = [...boxCountCis]
    .map((specialtyCis) =>
      classifyByBoxCount(
        specialtyCis,
        renewalInfo.get(specialtyCis)!,
        boxes,
        today,
      ),
    )
    .filter((item): item is RenewalItem => item !== null);

  return [...consumptionItems, ...boxCountItems].sort(compareItems);
}

type PrescriptionRenewalInfo = Readonly<{
  specialtyName: string;
  quantityKind: PrescriptionItemQuantityKind;
  theoreticalRenewalDate: string | null;
  toleranceDays: number | null;
}>;

/**
 * Une spécialité n'a normalement qu'un traitement actif : en cas d'homonymie
 * inattendue ou de plusieurs lignes d'ordonnance FRACTIONAL pour un même
 * traitement (historique, ticket 45), la première rencontrée est retenue —
 * `prescriptionItems` est attendu trié de la plus récemment émise à la plus
 * ancienne (voir `listPrescriptionItems`) — sans en privilégier une autre :
 * purement informatif.
 */
function indexPrescriptionRenewalInfo(
  treatments: readonly Treatment[],
  prescriptionItems: readonly PrescriptionItem[],
): ReadonlyMap<string, PrescriptionRenewalInfo> {
  const treatmentById = new Map(
    treatments.map((treatment) => [treatment.id, treatment]),
  );

  const index = new Map<string, PrescriptionRenewalInfo>();
  for (const item of prescriptionItems) {
    if (item.dispensingMode !== 'FRACTIONAL') continue;
    const treatment = treatmentById.get(item.treatmentId);
    if (!treatment || index.has(treatment.specialtyCis)) continue;
    index.set(treatment.specialtyCis, {
      specialtyName: treatment.specialtyName,
      quantityKind: item.quantityKind,
      theoreticalRenewalDate: item.theoreticalRenewalDate,
      toleranceDays: item.toleranceDays,
    });
  }
  return index;
}

function classify(
  medication: MedicationForecast,
  nextPreparationEndDate: string,
  renewalInfo: ReadonlyMap<string, PrescriptionRenewalInfo>,
): RenewalItem | null {
  if (medication.insufficientForNextPreparation) {
    return toRenewalItem(
      medication,
      'INSUFFICIENT_FOR_NEXT_PREPARATION',
      renewalInfo,
    );
  }
  if (medication.coverage.status === 'RUNS_OUT') {
    const urgency =
      medication.coverage.date <= nextPreparationEndDate
        ? 'RUNS_OUT_SOON'
        : 'LOW_STOCK';
    return toRenewalItem(medication, urgency, renewalInfo);
  }
  return null;
}

function toRenewalItem(
  medication: MedicationForecast,
  urgency: RenewalUrgency,
  renewalInfo: ReadonlyMap<string, PrescriptionRenewalInfo>,
): RenewalItem {
  const coverage = medication.coverage;
  const ruptureDate = coverage.status === 'RUNS_OUT' ? coverage.date : null;
  const info = renewalInfo.get(medication.specialtyCis) ?? null;
  const theoreticalRenewalDate = info?.theoreticalRenewalDate ?? null;
  const window =
    theoreticalRenewalDate === null
      ? null
      : theoreticalRenewalWindow(
          theoreticalRenewalDate,
          info?.toleranceDays ?? null,
        );
  return Object.freeze({
    specialtyCis: medication.specialtyCis,
    specialtyName: medication.specialtyName,
    urgency,
    availableHalfUnits: medication.availableHalfUnits,
    nextPreparationHalfUnits: medication.nextPreparationHalfUnits,
    missingHalfUnits: medication.missingHalfUnits,
    ruptureDate,
    ruptureCause: coverage.status === 'RUNS_OUT' ? coverage.cause : null,
    theoreticalRenewalDate,
    theoreticalRenewalWindow: window,
    runsOutBeforeRenewalWindow:
      window !== null && ruptureDate !== null && ruptureDate < window.start,
    usableBoxCount: null,
  });
}

/**
 * Cas `BOX_COUNT` (ticket 47) : pas de prévision de consommation régulière
 * pour un traitement typiquement `AS_NEEDED`, donc pas de rupture datée ni de
 * vérification croisée avec la fenêtre de renouvellement — seul le nombre de
 * boîtes réellement utilisables en stock déclenche l'alerte.
 */
function classifyByBoxCount(
  specialtyCis: string,
  info: PrescriptionRenewalInfo,
  boxes: readonly MedicationBox[],
  today: string,
): RenewalItem | null {
  const usableBoxCount = boxes.filter(
    (box) =>
      box.specialtyCis === specialtyCis && usableQuantity(box, today) > 0,
  ).length;
  if (usableBoxCount > LOW_BOX_COUNT_THRESHOLD) return null;

  const theoreticalRenewalDate = info.theoreticalRenewalDate;
  const window =
    theoreticalRenewalDate === null
      ? null
      : theoreticalRenewalWindow(theoreticalRenewalDate, info.toleranceDays);
  return Object.freeze({
    specialtyCis,
    specialtyName: info.specialtyName,
    urgency: usableBoxCount === 0 ? 'RUNS_OUT_SOON' : 'LOW_STOCK',
    availableHalfUnits: 0,
    nextPreparationHalfUnits: 0,
    missingHalfUnits: 0,
    ruptureDate: null,
    ruptureCause: null,
    theoreticalRenewalDate,
    theoreticalRenewalWindow: window,
    runsOutBeforeRenewalWindow: false,
    usableBoxCount,
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
