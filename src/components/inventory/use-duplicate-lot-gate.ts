import { useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  findDuplicateLotBox,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';

/**
 * Avant d'enregistrer une boîte (scan ou manuel), signale si son lot
 * correspond exactement à celui d'une boîte déjà en stock pour la même
 * présentation, avec un stock restant positif : une erreur de saisie du lot
 * passerait autrement inaperçue. Contrairement à `useGenericEquivalenceGate`,
 * refuser ici n'enregistre rien : ce n'est pas une correspondance à écarter
 * mais une saisie à corriger (ticket 33).
 */
export function useDuplicateLotGate(personalDatabase: SQLiteDatabase) {
  const [existingBox, setExistingBox] = useState<MedicationBox | null>(null);
  const resolveRef = useRef<((proceed: boolean) => void) | null>(null);

  async function checkBeforeSave(
    presentationCip13: string,
    lot: string | null,
  ): Promise<boolean> {
    const boxes = await listMedicationBoxes(personalDatabase);
    const duplicate = findDuplicateLotBox(boxes, presentationCip13, lot);
    if (duplicate === null) return true;
    setExistingBox(duplicate);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }

  function confirm(): void {
    setExistingBox(null);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }

  function cancel(): void {
    setExistingBox(null);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }

  return { pendingDuplicate: existingBox, checkBeforeSave, confirm, cancel };
}
