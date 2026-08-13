import { isExpired, type MedicationBox } from '@/domain/inventory/inventory';
import {
  generatePreparationSnapshot,
  preparationStartDate,
  type TreatmentGenericEquivalence,
} from '@/domain/preparations/preparation';
import { addCivilDays } from '@/domain/shared/dates';
import type { Treatment } from '@/domain/treatments/treatment';

/** Marge au-delà du besoin hebdomadaire sous laquelle le stock est dit proche. */
export const LOW_STOCK_MARGIN_PERCENT = 25;

/** Fenêtre calendaire, date du jour incluse, pour une péremption proche. */
export const EXPIRATION_WARNING_DAYS = 30;

export type StockAlert = Readonly<{
  status: 'INSUFFICIENT' | 'CLOSE';
  specialtyCis: string;
  specialtyName: string;
  requiredHalfUnits: number;
  usableStockHalfUnits: number;
  missingHalfUnits: number;
}>;

export type ExpirationAlert = Readonly<{
  boxId: number;
  specialtyName: string;
  lot: string | null;
  expirationDate: string;
  remainingQuantity: number;
}>;

export type InventoryAlerts = Readonly<{
  startDate: string;
  endDate: string;
  stock: readonly StockAlert[];
  expirations: readonly ExpirationAlert[];
}>;

export function buildInventoryAlerts(
  treatments: readonly Treatment[],
  boxes: readonly MedicationBox[],
  referenceDate: string,
  options: Readonly<{
    lowStockMarginPercent?: number;
    expirationWarningDays?: number;
    equivalences?: readonly TreatmentGenericEquivalence[];
  }> = {},
): InventoryAlerts {
  const lowStockMarginPercent =
    options.lowStockMarginPercent ?? LOW_STOCK_MARGIN_PERCENT;
  const expirationWarningDays =
    options.expirationWarningDays ?? EXPIRATION_WARNING_DAYS;
  assertNonNegativeInteger(lowStockMarginPercent, 'marge de stock');
  assertNonNegativeInteger(expirationWarningDays, 'délai de péremption');

  const snapshot = generatePreparationSnapshot(
    treatments,
    boxes,
    preparationStartDate(referenceDate),
    referenceDate,
    options.equivalences ?? [],
  );
  const stock = snapshot.requirements.flatMap((requirement): StockAlert[] => {
    const closeLimit =
      requirement.requiredHalfUnits +
      Math.ceil((requirement.requiredHalfUnits * lowStockMarginPercent) / 100);
    if (requirement.missingHalfUnits > 0) {
      return [{ status: 'INSUFFICIENT', ...requirement }];
    }
    if (requirement.usableStockHalfUnits <= closeLimit) {
      return [{ status: 'CLOSE', ...requirement }];
    }
    return [];
  });

  const warningEndDate = addCivilDays(referenceDate, expirationWarningDays);
  const expirations = boxes
    .filter(
      (box) =>
        box.remainingQuantity > 0 &&
        !isExpired(box.expirationDate, referenceDate) &&
        box.expirationDate <= warningEndDate,
    )
    .map((box) => ({
      boxId: box.id,
      specialtyName: box.specialtyName,
      lot: box.lot,
      expirationDate: box.expirationDate,
      remainingQuantity: box.remainingQuantity,
    }))
    .sort(
      (left, right) =>
        left.expirationDate.localeCompare(right.expirationDate) ||
        left.specialtyName.localeCompare(right.specialtyName) ||
        left.boxId - right.boxId,
    );

  return Object.freeze({
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    stock: Object.freeze(stock),
    expirations: Object.freeze(expirations),
  });
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`La ${label} doit être un entier positif ou nul.`);
  }
}
