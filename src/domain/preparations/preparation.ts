import {
  isExpired,
  usableQuantity,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import type { IntakeSlot, Treatment } from '@/domain/treatments/treatment';

export const PREPARATION_DURATION_DAYS = 7;

/** Le pilulier à venir commence toujours le lendemain de sa préparation. */
export function preparationStartDate(referenceDate: string): string {
  return addCivilDays(referenceDate, 1);
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

export type PreparationSnapshot = Readonly<{
  startDate: string;
  endDate: string;
  items: readonly PreparationItemSnapshot[];
  requirements: readonly MedicationRequirement[];
  hasShortages: boolean;
}>;

export type BoxVerification =
  | Readonly<{ status: 'EXPIRED'; box: MedicationBox }>
  | Readonly<{ status: 'WRONG_MEDICATION'; box: MedicationBox }>
  | Readonly<{ status: 'INSUFFICIENT'; box: MedicationBox }>
  | Readonly<{
      status: 'VALID';
      box: MedicationBox;
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
  | Readonly<{ status: 'UNKNOWN' | 'AMBIGUOUS' }>;

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

/** Exige les données permettant de relier le scan à une boîte précise du stock. */
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
  if (matches.length > 1) return { status: 'AMBIGUOUS' };
  return { status: 'MATCHED', box: matches[0] };
}

/**
 * Boîtes du stock rattachées à un médicament, du lot à utiliser en premier
 * (FEFO) vers les boîtes périmées, reléguées à la fin sans être masquées.
 */
export function listBoxesForMedication(
  specialtyCis: string,
  boxes: readonly MedicationBox[],
  referenceDate: string,
): readonly MedicationBox[] {
  return boxes
    .filter((box) => box.specialtyCis === specialtyCis)
    .sort((left, right) => {
      const leftExpired = isExpired(left.expirationDate, referenceDate);
      const rightExpired = isExpired(right.expirationDate, referenceDate);
      if (leftExpired !== rightExpired) return leftExpired ? 1 : -1;
      return (
        left.expirationDate.localeCompare(right.expirationDate) ||
        left.id - right.id
      );
    });
}

/** Vérifie une boîte connue sans jamais accepter une substitution implicite. */
export function verifyPreparationBox(
  specialtyCis: string,
  requiredHalfUnits: number,
  scannedBox: MedicationBox,
  availableBoxes: readonly MedicationBox[],
  referenceDate: string,
): BoxVerification {
  if (isExpired(scannedBox.expirationDate, referenceDate)) {
    return { status: 'EXPIRED', box: scannedBox };
  }
  if (scannedBox.specialtyCis !== specialtyCis) {
    return { status: 'WRONG_MEDICATION', box: scannedBox };
  }
  if (scannedBox.remainingQuantity * 2 < requiredHalfUnits) {
    return { status: 'INSUFFICIENT', box: scannedBox };
  }
  const eligible = availableBoxes
    .filter(
      (box) =>
        box.specialtyCis === specialtyCis &&
        !isExpired(box.expirationDate, referenceDate) &&
        box.remainingQuantity * 2 >= requiredHalfUnits,
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
    isFefo: recommendedBox.id === scannedBox.id,
    recommendedBox,
  };
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
): PreparationSnapshot {
  const endDate = addCivilDays(startDate, PREPARATION_DURATION_DAYS - 1);
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
  const requirements = [...requirementsByCis.entries()]
    .map(([specialtyCis, requirement]) => {
      const usableStockHalfUnits = stockByCis.get(specialtyCis) ?? 0;
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

function addCivilDays(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Date invalide.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
