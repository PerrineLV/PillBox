import { useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getGenericGroupMembers } from '@/infrastructure/medications/medication-reference';
import { queuePendingGenericEquivalenceDraft } from '@/infrastructure/treatments/pending-generic-equivalence-draft';

export type DraftGenericEquivalenceOutcome = 'confirmed' | 'skipped' | 'none';

/**
 * Variante de `useGenericEquivalenceGate` (ticket 24) pour un traitement en
 * cours de création (ticket 29), identifié uniquement par son CIS et son
 * nom — pas encore par un identifiant. Avant d'ajouter une boîte au stock
 * depuis le lien de l'écran de création, détecte si son CIS — différent de
 * celui de ce traitement — appartient au même groupe générique officiel
 * (BDPM), et demande la même confirmation explicite. La confirmation ne peut
 * pas être mémorisée immédiatement (aucun `treatmentId` n'existe encore) :
 * elle est mise en attente et enregistrée dès la création effective du
 * traitement.
 */
export function useDraftGenericEquivalencePrompt(
  referenceDatabase: SQLiteDatabase,
  draftTreatmentCis: string | undefined,
  draftTreatmentName: string | undefined,
) {
  const [pending, setPending] = useState<{
    cis: string;
    specialtyName: string;
    groupLabel: string;
  } | null>(null);
  const resolveRef = useRef<
    ((outcome: 'confirmed' | 'skipped') => void) | null
  >(null);

  async function checkBeforeSave(
    cis: string,
    specialtyName: string,
  ): Promise<DraftGenericEquivalenceOutcome> {
    if (!draftTreatmentCis || !draftTreatmentName || cis === draftTreatmentCis)
      return 'none';
    try {
      const members = await getGenericGroupMembers(referenceDatabase, cis);
      const match = members.find((member) => member.cis === draftTreatmentCis);
      if (!match) return 'none';
      setPending({ cis, specialtyName, groupLabel: match.groupLabel });
      return await new Promise<'confirmed' | 'skipped'>((resolve) => {
        resolveRef.current = resolve;
      });
    } catch {
      // Purement informatif : une source indisponible ne bloque jamais
      // l'ajout de la boîte, comme le gate équivalent (ticket 24).
      return 'none';
    }
  }

  function resolve(confirm: boolean): void {
    if (confirm && pending) queuePendingGenericEquivalenceDraft(pending);
    setPending(null);
    const done = resolveRef.current;
    resolveRef.current = null;
    done?.(confirm ? 'confirmed' : 'skipped');
  }

  return {
    pendingMatch:
      pending && draftTreatmentName
        ? {
            expectedSpecialtyName: draftTreatmentName,
            scannedSpecialtyName: pending.specialtyName,
            groupLabel: pending.groupLabel,
          }
        : null,
    checkBeforeSave,
    confirm: () => resolve(true),
    skip: () => resolve(false),
  };
}
