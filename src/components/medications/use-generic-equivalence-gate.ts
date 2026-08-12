import { useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  findGenericEquivalenceCandidates,
  type GenericEquivalenceCandidate as Candidate,
} from '@/infrastructure/treatments/generic-equivalence-candidates';
import { confirmGenericEquivalence } from '@/infrastructure/treatments/generic-equivalence-repository';

/**
 * Avant d'ajouter une boîte au stock, détecte si son CIS — bien que
 * différent de celui de chaque traitement actif — appartient au même groupe
 * générique officiel (BDPM) qu'un traitement pour lequel ce couple
 * (traitement, CIS) n'a encore jamais été confirmé, et demande une
 * confirmation explicite avant de poursuivre l'ajout. Étend à l'ajout au
 * stock la vérification déjà appliquée à la désignation d'une boîte pendant
 * une préparation (ticket 24) : jamais d'association automatique ou
 * silencieuse, une confirmation par couple suffit ensuite (mémorisée et
 * révocable depuis la fiche du traitement).
 *
 * Purement informatif si le référentiel des groupes génériques ou la liste
 * des traitements est indisponible : l'ajout se comporte alors comme avant
 * ce ticket, sans jamais bloquer l'enregistrement de la boîte.
 */
export function useGenericEquivalenceGate(
  personalDatabase: SQLiteDatabase,
  referenceDatabase: SQLiteDatabase,
) {
  const [queue, setQueue] = useState<readonly Candidate[]>([]);
  const [scanned, setScanned] = useState<{ cis: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const resolveRef = useRef<(() => void) | null>(null);

  async function checkBeforeSave(cis: string, name: string): Promise<void> {
    try {
      const candidates = await findGenericEquivalenceCandidates(
        personalDatabase,
        referenceDatabase,
        cis,
      );
      if (candidates.length === 0) return;

      setScanned({ cis, name });
      setQueue(candidates);
      await new Promise<void>((resolve) => {
        resolveRef.current = resolve;
      });
    } catch {
      // Purement informatif : une source indisponible ne bloque jamais
      // l'ajout de la boîte, comme avant ce ticket.
    }
  }

  function advance(): void {
    const rest = queue.slice(1);
    setQueue(rest);
    if (rest.length === 0) {
      const resolve = resolveRef.current;
      resolveRef.current = null;
      resolve?.();
    }
  }

  async function confirmCurrent(): Promise<void> {
    const current = queue[0];
    if (!current || !scanned) return;
    setBusy(true);
    try {
      await confirmGenericEquivalence(personalDatabase, {
        treatmentId: current.treatmentId,
        cis: scanned.cis,
        specialtyName: scanned.name,
        groupLabel: current.groupLabel,
      });
      advance();
    } finally {
      setBusy(false);
    }
  }

  function skipCurrent(): void {
    advance();
  }

  const current = queue[0] ?? null;
  return {
    pendingMatch:
      current && scanned
        ? {
            expectedSpecialtyName: current.treatmentName,
            scannedSpecialtyName: scanned.name,
            groupLabel: current.groupLabel,
          }
        : null,
    busy,
    checkBeforeSave,
    confirmCurrent,
    skipCurrent,
  };
}
