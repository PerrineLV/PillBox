import type { MedicationBox } from '@/domain/inventory/inventory';
import type { PreparationItemSnapshot } from '@/domain/preparations/preparation';
import { INTAKE_SLOTS } from '@/domain/treatments/treatment';

export type BoxFillingContribution = Readonly<{
  boxId: number;
  quantityHalfUnits: number;
}>;

/** Quantité explicitement confirmée, en unités entières ou demi-unités. */
export function parseBoxContribution(
  value: string,
  maximumHalfUnits: number,
): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.[05])?$/.test(normalized)) return null;
  const halfUnits = Number(normalized) * 2;
  return Number.isSafeInteger(halfUnits) &&
    halfUnits > 0 &&
    halfUnits <= maximumHalfUnits
    ? halfUnits
    : null;
}

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

/** Quantités du seul médicament en cours, regroupées par case du pilulier. */
export function buildMedicationFillingCells(
  items: readonly PreparationItemSnapshot[],
  contributions: readonly BoxFillingContribution[],
) {
  const depositedByItem = new Map<PreparationItemSnapshot, number>();
  for (const step of buildBoxFillingGuide(items, contributions, [])) {
    for (const segment of step.segments) {
      depositedByItem.set(
        segment.item,
        (depositedByItem.get(segment.item) ?? 0) + segment.quantityHalfUnits,
      );
    }
  }
  const cells = new Map<
    string,
    {
      date: string;
      slot: PreparationItemSnapshot['slot'];
      remainingHalfUnits: number;
      depositedHalfUnits: number;
    }
  >();
  for (const item of items) {
    const key = `${item.date}-${item.slot}`;
    const cell = cells.get(key) ?? {
      date: item.date,
      slot: item.slot,
      remainingHalfUnits: 0,
      depositedHalfUnits: 0,
    };
    const deposited = depositedByItem.get(item) ?? 0;
    cell.depositedHalfUnits += deposited;
    cell.remainingHalfUnits += item.quantityHalfUnits - deposited;
    cells.set(key, cell);
  }
  return [...cells.values()];
}
