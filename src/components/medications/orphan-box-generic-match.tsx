import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect } from 'react';

import { GenericMatchConfirmation } from './generic-match-confirmation';
import { useGenericEquivalenceGate } from './use-generic-equivalence-gate';

/**
 * Depuis la fiche d'une boîte déjà orpheline (ticket 28), propose la même
 * confirmation explicite qu'à l'ajout au stock ou pendant une préparation
 * (ticket 24), pour le cas où la boîte existait déjà avant la création du
 * traitement correspondant : cette confirmation n'a alors jamais eu
 * l'occasion de se déclencher. N'affiche rien si aucune correspondance de
 * groupe générique non confirmée n'est détectée pour ce médicament.
 *
 * Suppose que la connexion `medication-reference.db` est déjà fournie par un
 * `SQLiteProvider` ancêtre, partagé avec le reste de l'écran : deux
 * connexions distinctes ouvertes en parallèle avec `forceOverwrite` sur le
 * même fichier entrent en course et font planter l'import (constaté en
 * combinant ce composant avec `GenericGroupSectionWithDatabase` sur le même
 * écran).
 */
export function OrphanBoxGenericMatch({
  personalDatabase,
  specialtyCis,
  specialtyName,
  onConfirmed,
}: Readonly<{
  personalDatabase: SQLiteDatabase;
  specialtyCis: string;
  specialtyName: string;
  onConfirmed(): void;
}>) {
  const referenceDatabase = useSQLiteContext();
  const gate = useGenericEquivalenceGate(personalDatabase, referenceDatabase);

  useEffect(() => {
    void gate.checkBeforeSave(specialtyCis, specialtyName);
    // Une seule détection par affichage de cette boîte : un changement de
    // CIS (autre boîte) relance la détection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialtyCis]);

  if (!gate.pendingMatch) return null;
  return (
    <GenericMatchConfirmation
      visible
      expectedSpecialtyName={gate.pendingMatch.expectedSpecialtyName}
      scannedSpecialtyName={gate.pendingMatch.scannedSpecialtyName}
      groupLabel={gate.pendingMatch.groupLabel}
      busy={gate.busy}
      onCancel={gate.skipCurrent}
      onConfirm={() => {
        void gate.confirmCurrent().then(onConfirmed);
      }}
    />
  );
}
