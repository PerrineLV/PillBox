import { PREPARATION_DURATION_DAYS } from '@/domain/preparations/preparation';
import { addCivilDays } from '@/domain/shared/dates';
import { INTAKE_SLOTS, type IntakeSlot } from '@/domain/treatments/treatment';

/**
 * Une case de la grille du pilulier : le croisement d'un jour et d'un créneau.
 * `EMPTY` n'est pas une case à préparer, c'est une absence de prise.
 */
export type WeeklyGridCell = 'EMPTY' | 'TO_PREPARE' | 'CURRENT' | 'READY';

export type WeeklyGridItem = Readonly<{
  date: string;
  slot: IntakeSlot;
  specialtyCis: string;
  /** Présent dans un snapshot de préparation, utile au suivi quantitatif. */
  quantityHalfUnits?: number;
}>;

export type WeeklyGridContribution = Readonly<{
  specialtyCis: string;
  quantityHalfUnits: number;
}>;

export type WeeklyGrid = Readonly<{
  startDate: string;
  days: readonly string[];
  /** Uniquement les créneaux servis par un traitement de la semaine. */
  slots: readonly IntakeSlot[];
  /** Une ligne par créneau servi, sept colonnes par ligne. */
  rows: readonly (readonly WeeklyGridCell[])[];
  preparedCases: number;
  totalCases: number;
}>;

/**
 * Grille de la semaine, dérivée des prises réellement prévues. L'axe des
 * créneaux ne compte que ceux servis : avec un traitement du matin et deux du
 * midi, la ligne « Coucher » n'existe pas.
 *
 * Une case est prête lorsque tous les médicaments qu'elle contient ont été
 * déposés ; le décompte des prises, lui, compte chaque médicament séparément
 * (7 jours × la somme des créneaux de chaque médicament).
 */
export function buildWeeklyGrid({
  startDate,
  items,
  preparedCis = [],
  preparedContributions = [],
  currentCis = null,
}: {
  startDate: string;
  items: readonly WeeklyGridItem[];
  preparedCis?: readonly string[];
  preparedContributions?: readonly WeeklyGridContribution[];
  currentCis?: string | null;
}): WeeklyGrid {
  const days = Array.from({ length: PREPARATION_DURATION_DAYS }, (_, index) =>
    addCivilDays(startDate, index),
  );
  const prepared = new Set(preparedCis);
  const inWeek = items.filter((item) => days.includes(item.date));
  const preparedItemIndexes = filledItemIndexes(inWeek, preparedContributions);
  const isPrepared = (item: WeeklyGridItem, index: number): boolean =>
    prepared.has(item.specialtyCis) || preparedItemIndexes.has(index);
  const slots = INTAKE_SLOTS.filter((slot) =>
    inWeek.some((item) => item.slot === slot),
  );
  const rows = slots.map((slot) =>
    days.map((date): WeeklyGridCell => {
      const cellItems = inWeek
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.slot === slot && item.date === date);
      if (cellItems.length === 0) return 'EMPTY';
      if (cellItems.every(({ item, index }) => isPrepared(item, index)))
        return 'READY';
      return currentCis !== null &&
        cellItems.some(
          ({ item, index }) =>
            item.specialtyCis === currentCis && !isPrepared(item, index),
        )
        ? 'CURRENT'
        : 'TO_PREPARE';
    }),
  );
  return {
    startDate,
    days,
    slots,
    rows,
    preparedCases: inWeek.filter((item, index) => isPrepared(item, index))
      .length,
    totalCases: inWeek.length,
  };
}

/**
 * Répartit chaque quantité déjà retenue sur les prises du médicament dans
 * l'ordre chronologique. Une contribution partielle ne peut ainsi plus faire
 * apparaître toute la semaine comme remplie.
 */
function filledItemIndexes(
  items: readonly WeeklyGridItem[],
  contributions: readonly WeeklyGridContribution[],
): ReadonlySet<number> {
  const availableByCis = new Map<string, number>();
  for (const contribution of contributions) {
    availableByCis.set(
      contribution.specialtyCis,
      (availableByCis.get(contribution.specialtyCis) ?? 0) +
        contribution.quantityHalfUnits,
    );
  }

  const filled = new Set<number>();
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        left.item.date.localeCompare(right.item.date) ||
        INTAKE_SLOTS.indexOf(left.item.slot) -
          INTAKE_SLOTS.indexOf(right.item.slot),
    );
  for (const { item, index } of ordered) {
    const quantity = item.quantityHalfUnits;
    if (quantity === undefined) continue;
    const available = availableByCis.get(item.specialtyCis) ?? 0;
    if (available < quantity) {
      // Le reliquat est déjà déposé dans cette prise, sans la compléter : il
      // ne peut pas être réutilisé pour faire paraître une prise plus tardive
      // comme remplie.
      availableByCis.set(item.specialtyCis, 0);
      continue;
    }
    filled.add(index);
    availableByCis.set(item.specialtyCis, available - quantity);
  }
  return filled;
}
