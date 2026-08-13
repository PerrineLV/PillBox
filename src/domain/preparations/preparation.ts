import {
  isExpired,
  usableQuantity,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { addCivilDays } from '@/domain/shared/dates';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import type { IntakeSlot, Treatment } from '@/domain/treatments/treatment';

export const PREPARATION_DURATION_DAYS = 7;

/** Le pilulier à venir commence toujours le lendemain de sa préparation. */
export function preparationStartDate(referenceDate: string): string {
  return addCivilDays(referenceDate, 1);
}

/** Dernier jour couvert par une préparation démarrée à cette date. */
export function preparationEndDate(startDate: string): string {
  return addCivilDays(startDate, PREPARATION_DURATION_DAYS - 1);
}

export const PREPARATION_WEEK_CHOICES = ['CURRENT', 'NEXT'] as const;

export type PreparationWeekChoice = (typeof PREPARATION_WEEK_CHOICES)[number];

export type PreparationWeek = Readonly<{
  choice: PreparationWeekChoice;
  startDate: string;
  endDate: string;
}>;

/**
 * Semaines proposées au démarrage : celle qui commence demain, toujours par
 * défaut, et la suivante. Aucune autre période n'est proposée afin de garder
 * un choix explicite et lisible.
 */
export function preparationWeeks(
  referenceDate: string,
): readonly PreparationWeek[] {
  const currentStart = preparationStartDate(referenceDate);
  const nextStart = addCivilDays(currentStart, PREPARATION_DURATION_DAYS);
  return Object.freeze([
    Object.freeze({
      choice: 'CURRENT' as const,
      startDate: currentStart,
      endDate: preparationEndDate(currentStart),
    }),
    Object.freeze({
      choice: 'NEXT' as const,
      startDate: nextStart,
      endDate: preparationEndDate(nextStart),
    }),
  ]);
}

/** Préparation déjà enregistrée localement, réduite à ce qui distingue une semaine. */
export type KnownPreparation = Readonly<{
  id: number;
  startDate: string;
  status: 'DRAFT' | 'COMPLETED';
}>;

/**
 * `ALREADY_PREPARED` interdit un doublon pour une semaine déjà validée ;
 * `IN_PROGRESS` signale qu'une préparation incomplète existe déjà et doit être
 * reprise plutôt que recréée.
 */
export type PreparationWeekState =
  'AVAILABLE' | 'IN_PROGRESS' | 'ALREADY_PREPARED';

export function preparationWeekState(
  startDate: string,
  known: readonly KnownPreparation[],
): PreparationWeekState {
  const sameWeek = known.filter((item) => item.startDate === startDate);
  if (sameWeek.some((item) => item.status === 'COMPLETED'))
    return 'ALREADY_PREPARED';
  if (sameWeek.some((item) => item.status === 'DRAFT')) return 'IN_PROGRESS';
  return 'AVAILABLE';
}

export type PreparationItemSnapshot = Readonly<{
  treatmentId: number;
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
  date: string;
  slot: IntakeSlot;
  quantityHalfUnits: number;
}>;

export type MedicationRequirement = Readonly<{
  specialtyCis: string;
  specialtyName: string;
  requiredHalfUnits: number;
  usableStockHalfUnits: number;
  missingHalfUnits: number;
}>;

/**
 * Équivalence générique confirmée et mémorisée pour un traitement précis
 * (ticket 24) : le CIS d'un autre membre du même groupe générique officiel,
 * explicitement accepté pour ce traitement. Le domaine ne lit jamais la
 * mémorisation elle-même (infrastructure) ; l'appelant fournit cette liste
 * déjà chargée, afin de ne créer aucune dépendance vers l'infrastructure ou
 * vers le module de vérification de boîte.
 */
export type TreatmentGenericEquivalence = Readonly<{
  treatmentId: number;
  cis: string;
}>;

/**
 * Pour chaque CIS porté par au moins un traitement, l'ensemble des CIS dont
 * le stock compte pour ce traitement : lui-même, plus les CIS confirmés
 * comme équivalence générique pour n'importe lequel des traitements qui
 * partagent ce CIS. Un CIS jamais confirmé pour ce traitement précis n'est
 * jamais ajouté, même s'il appartient au même groupe générique officiel :
 * seules les équivalences explicitement mémorisées comptent, jamais une
 * déduction par groupe. Factorisé ici afin que `generatePreparationSnapshot`
 * et `buildStockForecast` restent cohérents entre eux.
 */
export function buildAcceptedCisIndex(
  treatments: readonly Treatment[],
  equivalences: readonly TreatmentGenericEquivalence[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const treatmentIdsByCis = new Map<string, Set<number>>();
  for (const treatment of treatments) {
    const ids =
      treatmentIdsByCis.get(treatment.specialtyCis) ?? new Set<number>();
    ids.add(treatment.id);
    treatmentIdsByCis.set(treatment.specialtyCis, ids);
  }

  const extraCisByTreatmentId = new Map<number, Set<string>>();
  for (const equivalence of equivalences) {
    const extra =
      extraCisByTreatmentId.get(equivalence.treatmentId) ?? new Set<string>();
    extra.add(equivalence.cis);
    extraCisByTreatmentId.set(equivalence.treatmentId, extra);
  }

  const index = new Map<string, ReadonlySet<string>>();
  for (const [cis, treatmentIds] of treatmentIdsByCis) {
    const accepted = new Set<string>([cis]);
    for (const treatmentId of treatmentIds) {
      const extra = extraCisByTreatmentId.get(treatmentId);
      if (extra) for (const extraCis of extra) accepted.add(extraCis);
    }
    index.set(cis, accepted);
  }
  return index;
}

export type PreparationSnapshot = Readonly<{
  startDate: string;
  endDate: string;
  items: readonly PreparationItemSnapshot[];
  requirements: readonly MedicationRequirement[];
  hasShortages: boolean;
}>;

/**
 * Résultat de la vérification d'une boîte face au reste à couvrir pour un
 * médicament (et non plus face à la totalité de son besoin hebdomadaire) :
 * - `INSUFFICIENT` : la boîte est vide, elle ne peut rien apporter.
 * - `PARTIAL` : la boîte est valide mais ne couvre pas tout le reste ; elle
 *   est utilisée intégralement et une seconde boîte complétera le besoin.
 * - `VALID` : la boîte couvre entièrement le reste à couvrir.
 */
export type BoxVerification =
  | Readonly<{ status: 'EXPIRED'; box: MedicationBox }>
  | Readonly<{ status: 'WRONG_MEDICATION'; box: MedicationBox }>
  | Readonly<{ status: 'INSUFFICIENT'; box: MedicationBox }>
  | Readonly<{
      status: 'PARTIAL';
      box: MedicationBox;
      quantityHalfUnits: number;
      remainingAfterHalfUnits: number;
    }>
  | Readonly<{
      status: 'VALID';
      box: MedicationBox;
      quantityHalfUnits: number;
      isFefo: boolean;
      recommendedBox: MedicationBox;
    }>;

export type ScannedBoxIdentity = Readonly<{
  presentationCip13: string;
  lot: string;
  expirationDate: string;
}>;

export type ScannedBoxMatch =
  | Readonly<{ status: 'MATCHED'; box: MedicationBox }>
  | Readonly<{ status: 'UNKNOWN' }>;

/**
 * Manière dont la boîte utilisée a été confirmée : lecture du DataMatrix ou
 * sélection explicite dans le stock déjà enregistré.
 */
export const BOX_VERIFICATION_METHODS = ['SCAN', 'MANUAL'] as const;

export type BoxVerificationMethod = (typeof BOX_VERIFICATION_METHODS)[number];

/**
 * Interdit d'enregistrer une vérification par scan sans sa preuve brute, et
 * inversement de rattacher un scan à une sélection manuelle.
 */
export function assertVerificationEvidence(
  method: BoxVerificationMethod,
  scanRaw: string | null,
): void {
  if (method === 'SCAN') {
    if (scanRaw === null || scanRaw.length === 0) {
      throw new Error(
        'Une vérification par scan exige la chaîne brute du DataMatrix.',
      );
    }
    return;
  }
  if (scanRaw !== null) {
    throw new Error(
      'Une sélection dans le stock ne peut pas être enregistrée comme un scan.',
    );
  }
}

/**
 * Exige les données permettant de relier le scan à une boîte précise du
 * stock. Le DataMatrix ne porte que la présentation, le lot et la
 * péremption : quand plusieurs boîtes du stock partagent exactement ce
 * triplet (deux boîtes identiques achetées le même jour, par exemple), elles
 * sont interchangeables du point de vue métier — le numéro de série GS1 (AI
 * 21) qui pourrait les distinguer est hors périmètre (ticket 13d).
 *
 * L'appelant doit passer la vue *effective* du stock (voir
 * `effectiveUsableBoxes`), qui reflète les quantités déjà réservées par la
 * préparation en cours : une boîte épuisée par une contribution déjà
 * enregistrée dans cette préparation est écartée au profit d'une autre boîte
 * identique encore disponible, sinon rescanner la même étiquette resterait
 * bloqué sur la boîte déjà vidée. Parmi les boîtes encore utilisables, la
 * résolution retient celle avec le moins de stock restant, pour épuiser en
 * priorité la boîte la plus proche de sa fin, avec un départage déterministe
 * par id croissant en cas d'égalité stricte.
 */
export function matchScannedBox(
  identity: ScannedBoxIdentity,
  boxes: readonly MedicationBox[],
): ScannedBoxMatch {
  const matches = boxes.filter(
    (box) =>
      box.presentationCip13 === identity.presentationCip13 &&
      box.lot === identity.lot &&
      box.expirationDate === identity.expirationDate,
  );
  if (matches.length === 0) return { status: 'UNKNOWN' };
  const [chosen] = [...matches].sort(
    (left, right) =>
      exhaustedRank(left) - exhaustedRank(right) ||
      left.remainingQuantity - right.remainingQuantity ||
      left.id - right.id,
  );
  return { status: 'MATCHED', box: chosen };
}

/** Place en dernier une boîte déjà vidée (dans le stock réel ou par cette préparation). */
function exhaustedRank(box: MedicationBox): number {
  return box.remainingQuantity > 0 ? 0 : 1;
}

/**
 * Statut d'une boîte face au besoin d'un médicament : périmée (jamais
 * utilisable), insuffisante seule (quantité restante trop faible) ou
 * suffisante. Sert à signaler une quantité insuffisante avant même que
 * l'utilisatrice ne tente de valider la boîte.
 */
export type BoxAvailability = 'SUFFICIENT' | 'INSUFFICIENT' | 'EXPIRED';

export function evaluateBoxAvailability(
  box: MedicationBox,
  requiredHalfUnits: number,
  referenceDate: string,
): BoxAvailability {
  if (isExpired(box.expirationDate, referenceDate)) return 'EXPIRED';
  return box.remainingQuantity * 2 >= requiredHalfUnits
    ? 'SUFFICIENT'
    : 'INSUFFICIENT';
}

const BOX_AVAILABILITY_RANK: Record<BoxAvailability, number> = {
  SUFFICIENT: 0,
  INSUFFICIENT: 1,
  EXPIRED: 2,
};

/**
 * Boîtes du stock rattachées à un médicament, priorisées selon péremption et
 * quantité : les boîtes suffisantes et non périmées d'abord (FEFO), puis les
 * boîtes insuffisantes seules, puis les boîtes périmées en dernier, sans
 * jamais être masquées.
 *
 * `additionalAcceptedCis` liste les CIS d'autres membres du même groupe
 * générique officiel déjà reconnus pour ce traitement (voir
 * `verifyPreparationBox`) : leurs boîtes apparaissent dans la même liste,
 * afin qu'une sélection manuelle bénéficie de la même correspondance qu'un
 * scan.
 */
export function listBoxesForMedication(
  specialtyCis: string,
  requiredHalfUnits: number,
  boxes: readonly MedicationBox[],
  referenceDate: string,
  additionalAcceptedCis: readonly string[] = [],
): readonly MedicationBox[] {
  const acceptedCis = new Set([specialtyCis, ...additionalAcceptedCis]);
  return boxes
    .filter((box) => acceptedCis.has(box.specialtyCis))
    .sort((left, right) => {
      const leftRank =
        BOX_AVAILABILITY_RANK[
          evaluateBoxAvailability(left, requiredHalfUnits, referenceDate)
        ];
      const rightRank =
        BOX_AVAILABILITY_RANK[
          evaluateBoxAvailability(right, requiredHalfUnits, referenceDate)
        ];
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (
        left.expirationDate.localeCompare(right.expirationDate) ||
        left.id - right.id
      );
    });
}

/**
 * Vérifie une boîte face au reste à couvrir pour un médicament, sans jamais
 * accepter une substitution implicite. `remainingHalfUnits` est le besoin qui
 * n'est pas encore couvert par d'éventuelles boîtes déjà retenues pour ce
 * médicament dans cette préparation : une boîte insuffisante seule n'est donc
 * plus bloquée, elle est acceptée comme contribution partielle tant qu'elle
 * n'est pas vide.
 *
 * `acceptedGenericCis` : CIS d'un autre membre du même groupe générique
 * officiel (BDPM), déjà reconnu comme équivalent pour ce traitement — soit
 * parce que l'utilisatrice vient de confirmer explicitement cette
 * correspondance, soit parce qu'elle l'avait déjà confirmée et mémorisée
 * auparavant. Cette fonction ne décide jamais seule qu'un CIS différent est
 * acceptable : c'est à l'appelant de résoudre cette correspondance (relation
 * officielle du groupe générique + confirmation explicite) avant d'appeler
 * cette fonction avec ce paramètre renseigné.
 */
export function verifyPreparationBox(
  specialtyCis: string,
  remainingHalfUnits: number,
  scannedBox: MedicationBox,
  availableBoxes: readonly MedicationBox[],
  referenceDate: string,
  acceptedGenericCis: string | null = null,
): BoxVerification {
  if (isExpired(scannedBox.expirationDate, referenceDate)) {
    return { status: 'EXPIRED', box: scannedBox };
  }
  const isAcceptedMedication =
    scannedBox.specialtyCis === specialtyCis ||
    (acceptedGenericCis !== null &&
      scannedBox.specialtyCis === acceptedGenericCis);
  if (!isAcceptedMedication) {
    return { status: 'WRONG_MEDICATION', box: scannedBox };
  }
  const usableHalfUnits = scannedBox.remainingQuantity * 2;
  if (usableHalfUnits <= 0) {
    return { status: 'INSUFFICIENT', box: scannedBox };
  }
  if (usableHalfUnits < remainingHalfUnits) {
    return {
      status: 'PARTIAL',
      box: scannedBox,
      quantityHalfUnits: usableHalfUnits,
      remainingAfterHalfUnits: remainingHalfUnits - usableHalfUnits,
    };
  }
  // Le lot recommandé (FEFO) ne mélange jamais deux produits différents même
  // pharmacologiquement équivalents : il porte uniquement sur les boîtes du
  // même CIS que celle en cours de vérification.
  const eligible = availableBoxes
    .filter(
      (box) =>
        box.specialtyCis === scannedBox.specialtyCis &&
        !isExpired(box.expirationDate, referenceDate) &&
        box.remainingQuantity * 2 >= remainingHalfUnits,
    )
    .sort(
      (left, right) =>
        left.expirationDate.localeCompare(right.expirationDate) ||
        left.id - right.id,
    );
  const recommendedBox = eligible[0] ?? scannedBox;
  return {
    status: 'VALID',
    box: scannedBox,
    quantityHalfUnits: remainingHalfUnits,
    isFefo: recommendedBox.id === scannedBox.id,
    recommendedBox,
  };
}

/** Une contribution déjà retenue : la boîte utilisée et la quantité qu'elle couvre. */
export type PreparationBoxContribution = Readonly<{
  boxId: number;
  quantityHalfUnits: number;
}>;

/** Reste à couvrir pour un médicament compte tenu des contributions déjà retenues. */
export function remainingHalfUnitsFor(
  requiredHalfUnits: number,
  contributions: readonly PreparationBoxContribution[],
): number {
  const usedHalfUnits = contributions.reduce(
    (sum, item) => sum + item.quantityHalfUnits,
    0,
  );
  return Math.max(0, requiredHalfUnits - usedHalfUnits);
}

/**
 * Vue du stock où chaque boîte déjà partiellement ou totalement retenue par
 * cette préparation voit sa quantité restante réduite d'autant : le stock en
 * base n'est décrémenté qu'à la validation finale, mais une même boîte ne
 * doit jamais être comptée deux fois au sein d'une même préparation.
 */
export function effectiveUsableBoxes(
  boxes: readonly MedicationBox[],
  contributions: readonly PreparationBoxContribution[],
): readonly MedicationBox[] {
  const reservedHalfUnitsByBoxId = new Map<number, number>();
  for (const contribution of contributions) {
    reservedHalfUnitsByBoxId.set(
      contribution.boxId,
      (reservedHalfUnitsByBoxId.get(contribution.boxId) ?? 0) +
        contribution.quantityHalfUnits,
    );
  }
  return boxes.map((box) => {
    const reservedHalfUnits = reservedHalfUnitsByBoxId.get(box.id);
    if (!reservedHalfUnits) return box;
    return {
      ...box,
      remainingQuantity: box.remainingQuantity - reservedHalfUnits / 2,
    };
  });
}

/**
 * Construit les données figées d'une préparation. Les quantités restent en
 * demi-unités afin qu'aucune fraction ne soit arrondie silencieusement.
 */
export function generatePreparationSnapshot(
  treatments: readonly Treatment[],
  boxes: readonly MedicationBox[],
  startDate: string,
  stockReferenceDate: string,
  equivalences: readonly TreatmentGenericEquivalence[] = [],
): PreparationSnapshot {
  const endDate = preparationEndDate(startDate);
  // Valide aussi la date de référence, même lorsque le stock est vide.
  addCivilDays(stockReferenceDate, 0);
  const treatmentsById = new Map(treatments.map((item) => [item.id, item]));
  const items = generateIntakes(treatments, startDate, endDate).map(
    (intake) => {
      const treatment = treatmentsById.get(intake.treatmentId);
      if (!treatment)
        throw new Error('Traitement introuvable pendant la génération.');
      return Object.freeze({
        ...intake,
        pharmaceuticalForm: treatment.pharmaceuticalForm,
      });
    },
  );

  const requirementsByCis = new Map<
    string,
    { specialtyName: string; requiredHalfUnits: number }
  >();
  for (const item of items) {
    const requirement = requirementsByCis.get(item.specialtyCis) ?? {
      specialtyName: item.specialtyName,
      requiredHalfUnits: 0,
    };
    requirement.requiredHalfUnits += item.quantityHalfUnits;
    requirementsByCis.set(item.specialtyCis, requirement);
  }

  const stockByCis = new Map<string, number>();
  for (const box of boxes) {
    const quantityHalfUnits = usableQuantity(box, stockReferenceDate) * 2;
    stockByCis.set(
      box.specialtyCis,
      (stockByCis.get(box.specialtyCis) ?? 0) + quantityHalfUnits,
    );
  }
  const acceptedCisIndex = buildAcceptedCisIndex(treatments, equivalences);
  const requirements = [...requirementsByCis.entries()]
    .map(([specialtyCis, requirement]) => {
      const acceptedCis =
        acceptedCisIndex.get(specialtyCis) ?? new Set([specialtyCis]);
      const usableStockHalfUnits = [...acceptedCis].reduce(
        (sum, cis) => sum + (stockByCis.get(cis) ?? 0),
        0,
      );
      return Object.freeze({
        specialtyCis,
        specialtyName: requirement.specialtyName,
        requiredHalfUnits: requirement.requiredHalfUnits,
        usableStockHalfUnits,
        missingHalfUnits: Math.max(
          0,
          requirement.requiredHalfUnits - usableStockHalfUnits,
        ),
      });
    })
    .sort((left, right) =>
      left.specialtyName.localeCompare(right.specialtyName),
    );

  return Object.freeze({
    startDate,
    endDate,
    items: Object.freeze(items),
    requirements: Object.freeze(requirements),
    hasShortages: requirements.some((item) => item.missingHalfUnits > 0),
  });
}
