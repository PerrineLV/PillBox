import { PREPARATION_DURATION_DAYS } from '@/domain/preparations/preparation';
import { addCivilDays } from '@/domain/shared/dates';
import { INTAKE_SLOTS, type IntakeSlot } from '@/domain/treatments/treatment';

/**
 * Une case de la grille du pilulier : le croisement d'un jour et d'un créneau.
 * `EMPTY` n'est pas une case à préparer, c'est une absence de prise.
 */
export type WeeklyGridCell = 'EMPTY' | 'TO_PREPARE' | 'READY';

export type WeeklyGridItem = Readonly<{
  date: string;
  slot: IntakeSlot;
  specialtyCis: string;
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
 * déposés ; le décompte des cases, lui, compte chaque médicament séparément
 * (7 jours × la somme des créneaux de chaque médicament).
 */
export function buildWeeklyGrid({
  startDate,
  items,
  preparedCis = [],
}: {
  startDate: string;
  items: readonly WeeklyGridItem[];
  preparedCis?: readonly string[];
}): WeeklyGrid {
  const days = Array.from({ length: PREPARATION_DURATION_DAYS }, (_, index) =>
    addCivilDays(startDate, index),
  );
  const prepared = new Set(preparedCis);
  const inWeek = items.filter((item) => days.includes(item.date));
  const slots = INTAKE_SLOTS.filter((slot) =>
    inWeek.some((item) => item.slot === slot),
  );
  const rows = slots.map((slot) =>
    days.map((date): WeeklyGridCell => {
      const cellItems = inWeek.filter(
        (item) => item.slot === slot && item.date === date,
      );
      if (cellItems.length === 0) return 'EMPTY';
      return cellItems.every((item) => prepared.has(item.specialtyCis))
        ? 'READY'
        : 'TO_PREPARE';
    }),
  );
  return {
    startDate,
    days,
    slots,
    rows,
    preparedCases: inWeek.filter((item) => prepared.has(item.specialtyCis))
      .length,
    totalCases: inWeek.length,
  };
}
