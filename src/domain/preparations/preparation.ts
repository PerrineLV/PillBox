import {
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
