import { INTAKE_SLOTS } from '@/domain/treatments/treatment';

import type { PreparationItemSnapshot } from './preparation';

export const ITEM_COMPLETION_STATUSES = [
  'FILLED',
  'PENDING_COMPLEMENT',
] as const;

export type ItemCompletionStatus = (typeof ITEM_COMPLETION_STATUSES)[number];

export type PreparationItemCompletion = Readonly<{
  treatmentId: number;
  specialtyCis: string;
  date: string;
  slot: PreparationItemSnapshot['slot'];
  quantityHalfUnits: number;
  status: ItemCompletionStatus;
}>;

/**
 * Répartit une couverture obtenue à la validation (ticket 09) sur les cases
 * d'un même médicament, dans l'ordre chronologique (jour puis créneau) :
 * chaque case est entièrement couverte ou laissée « en attente de
 * complément », jamais fractionnée à l'intérieur d'elle-même. Ce choix
 * d'allocation (remplir les jours les plus proches en premier) n'est déduit
 * d'aucune donnée pharmaceutique : c'est une convention d'affichage,
 * documentée ici faute d'indication contraire du ticket 30b.
 *
 * Réservé aux traitements à délivrance encadrée active (ticket 30) : c'est à
 * l'appelant de ne passer que les cases concernées, jamais celles d'un
 * traitement sans ce dispositif.
 */
export function allocateItemCompletion(
  items: readonly PreparationItemSnapshot[],
  coveredHalfUnits: number,
): readonly PreparationItemCompletion[] {
  const ordered = [...items].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      INTAKE_SLOTS.indexOf(left.slot) - INTAKE_SLOTS.indexOf(right.slot),
  );
  let remaining = coveredHalfUnits;
  return ordered.map((item) => {
    const covered = remaining >= item.quantityHalfUnits;
    if (covered) remaining -= item.quantityHalfUnits;
    return Object.freeze({
      treatmentId: item.treatmentId,
      specialtyCis: item.specialtyCis,
      date: item.date,
      slot: item.slot,
      quantityHalfUnits: item.quantityHalfUnits,
      status: covered ? 'FILLED' : 'PENDING_COMPLEMENT',
    });
  });
}
