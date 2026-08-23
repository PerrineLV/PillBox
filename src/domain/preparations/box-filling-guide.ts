import type { MedicationBox } from '@/domain/inventory/inventory';
import type { PreparationItemSnapshot } from '@/domain/preparations/preparation';
import { INTAKE_SLOTS } from '@/domain/treatments/treatment';

export type BoxFillingContribution = Readonly<{
  boxId: number;
  quantityHalfUnits: number;
}>;

export type BoxFillingSegment = Readonly<{
  item: PreparationItemSnapshot;
  quantityHalfUnits: number;
  /** La case n'est complète qu'après cette quantité. */
  completesItem: boolean;
}>;

export type BoxFillingGuideStep = Readonly<{
  contribution: BoxFillingContribution;
  box: MedicationBox | null;
  segments: readonly BoxFillingSegment[];
  /** Projection après validation finale, le stock n'est pas encore décrémenté. */
  remainingInBoxAfterHalfUnits: number | null;
}>;

/**
 * Répartit les contributions déjà choisies dans l'ordre chronologique des
 * prises. C'est uniquement un repère de remplissage : la préparation garde
 * les contributions par boîte, et non une nouvelle affectation persistée par
 * case. La même convention chronologique est employée pour les compléments
 * en attente (`allocateItemCompletion`).
 */
export function buildBoxFillingGuide(
  items: readonly PreparationItemSnapshot[],
  contributions: readonly BoxFillingContribution[],
  boxes: readonly MedicationBox[],
): readonly BoxFillingGuideStep[] {
  const chronologicalItems = [...items].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      INTAKE_SLOTS.indexOf(left.slot) - INTAKE_SLOTS.indexOf(right.slot),
  );
  const reservedByBoxId = new Map<number, number>();
  let itemIndex = 0;
  let assignedInCurrentItem = 0;

  return contributions.map((contribution) => {
    const segments: BoxFillingSegment[] = [];
    let available = contribution.quantityHalfUnits;
    while (available > 0 && itemIndex < chronologicalItems.length) {
      const item = chronologicalItems[itemIndex];
      const needed = item.quantityHalfUnits - assignedInCurrentItem;
      const assigned = Math.min(available, needed);
      assignedInCurrentItem += assigned;
      available -= assigned;
      const completesItem = assignedInCurrentItem === item.quantityHalfUnits;
      segments.push({ item, quantityHalfUnits: assigned, completesItem });
      if (completesItem) {
        itemIndex += 1;
        assignedInCurrentItem = 0;
      }
    }

    const alreadyReserved = reservedByBoxId.get(contribution.boxId) ?? 0;
    const totalReserved = alreadyReserved + contribution.quantityHalfUnits;
    reservedByBoxId.set(contribution.boxId, totalReserved);
    const box =
      boxes.find((candidate) => candidate.id === contribution.boxId) ?? null;
    return {
      contribution,
      box,
      segments,
      remainingInBoxAfterHalfUnits: box
        ? Math.max(0, box.remainingQuantity * 2 - totalReserved)
        : null,
    };
  });
}
