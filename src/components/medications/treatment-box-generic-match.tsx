import medicationReferenceAsset from '../../../assets/medications/medications.db';
import {
  SQLiteProvider,
  useSQLiteContext,
  type SQLiteDatabase,
} from 'expo-sqlite';
import { useEffect, useState } from 'react';

import {
  findGenericEquivalenceBoxCandidates,
  type GenericEquivalenceBoxCandidate,
} from '@/infrastructure/treatments/generic-equivalence-candidates';
import { confirmGenericEquivalence } from '@/infrastructure/treatments/generic-equivalence-repository';

import { GenericMatchConfirmation } from './generic-match-confirmation';

type Props = Readonly<{
  personalDatabase: SQLiteDatabase;
  treatmentId: number;
  specialtyCis: string;
  specialtyName: string;
  onDone(): void;
}>;

/**
 * Juste après la création d'un traitement (ticket 29), propose de rattacher
 * par équivalence générique confirmée les boîtes déjà présentes en stock
 * pour un autre membre du même groupe générique officiel (BDPM) : une boîte
 * ajoutée pendant la création (avant que le traitement n'ait d'identifiant)
 * n'a alors jamais pu être proposée à la confirmation. Purement informatif
 * et ignorable, une correspondance à la fois ; appelle `onDone` dès qu'il
 * n'en reste aucune à traiter, y compris s'il n'y en avait aucune dès le
 * départ.
 *
 * Ouvre sa propre connexion à `medication-reference.db` : suppose qu'aucune
 * autre connexion `forceOverwrite` vers ce même fichier n'est ouverte en
 * parallèle sur cet écran (sinon, utiliser `TreatmentBoxGenericMatch` sous
 * un `SQLiteProvider` ancêtre partagé).
 */
export function TreatmentBoxGenericMatchWithDatabase({
  personalDatabase,
  treatmentId,
  specialtyCis,
  specialtyName,
  onDone,
}: Props) {
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <TreatmentBoxGenericMatch
        personalDatabase={personalDatabase}
        treatmentId={treatmentId}
        specialtyCis={specialtyCis}
        specialtyName={specialtyName}
        onDone={onDone}
      />
    </SQLiteProvider>
  );
}

/** Suppose que la connexion `medication-reference.db` est déjà fournie par un `SQLiteProvider` ancêtre. */
export function TreatmentBoxGenericMatch({
  personalDatabase,
  treatmentId,
  specialtyCis,
  specialtyName,
  onDone,
}: Props) {
  const referenceDatabase = useSQLiteContext();
  const [queue, setQueue] = useState<
    readonly GenericEquivalenceBoxCandidate[] | null
  >(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findGenericEquivalenceBoxCandidates(
      personalDatabase,
      referenceDatabase,
      treatmentId,
      specialtyCis,
    )
      .then((candidates) => {
        if (!cancelled) setQueue(candidates);
      })
      .catch(() => {
        if (!cancelled) setQueue([]);
      });
    return () => {
      cancelled = true;
    };
    // Une seule détection, à l'ouverture : le stock ne change pas pendant
    // que cette confirmation reste affichée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (queue !== null && queue.length === 0) onDone();
  }, [queue, onDone]);

  if (queue === null || queue.length === 0) return null;
  const current = queue[0];

  async function resolve(confirm: boolean): Promise<void> {
    if (confirm) {
      setBusy(true);
      try {
        await confirmGenericEquivalence(personalDatabase, {
          treatmentId,
          cis: current.specialtyCis,
          specialtyName: current.specialtyName,
          groupLabel: current.groupLabel,
        });
      } finally {
        setBusy(false);
      }
    }
    setQueue((previous) => (previous ?? []).slice(1));
  }

  return (
    <GenericMatchConfirmation
      visible
      expectedSpecialtyName={specialtyName}
      scannedSpecialtyName={current.specialtyName}
      groupLabel={current.groupLabel}
      busy={busy}
      onCancel={() => void resolve(false)}
      onConfirm={() => void resolve(true)}
    />
  );
}
