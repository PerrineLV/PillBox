import medicationReferenceAsset from '../../../assets/medications/medications.db';
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TreatmentBoxGenericMatch } from '@/components/medications/treatment-box-generic-match';
import { AsNeededTreatmentForm } from '@/components/treatments/as-needed-treatment-form';
import { TreatmentForm } from '@/components/treatments/treatment-form';
import type { TreatmentDosageKind } from '@/domain/treatments/treatment';
import { synchronizeTreatmentIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { confirmGenericEquivalence } from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  drainPendingGenericEquivalenceDrafts,
  type PendingGenericEquivalenceDraft,
} from '@/infrastructure/treatments/pending-generic-equivalence-draft';
import { createTreatment } from '@/infrastructure/treatments/treatment-repository';
import { AppButton, spacing } from '@/ui';

export default function NewTreatmentScreen() {
  const params = useLocalSearchParams<{
    cis?: string;
    name?: string;
    form?: string;
  }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const [kind, setKind] = useState<TreatmentDosageKind>('SCHEDULED');
  const [createdTreatment, setCreatedTreatment] = useState<{
    id: number;
    specialtyCis: string;
    specialtyName: string;
  } | null>(null);
  const [pendingEquivalences, setPendingEquivalences] = useState<
    readonly PendingGenericEquivalenceDraft[]
  >([]);

  // Dépile les équivalences confirmées pendant un aller-retour vers l'ajout
  // de boîte (ticket 29) : elles ne peuvent être enregistrées qu'une fois le
  // traitement effectivement créé, faute d'identifiant avant cela.
  useFocusEffect(
    useCallback(() => {
      const drained = drainPendingGenericEquivalenceDrafts();
      if (drained.length > 0)
        setPendingEquivalences((previous) => [...previous, ...drained]);
    }, []),
  );

  if (!params.cis || !params.name)
    return <Text>Spécialité manquante. Revenez à la recherche.</Text>;

  const base = {
    specialtyCis: params.cis,
    specialtyName: params.name,
    pharmaceuticalForm: params.form || null,
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{ headerShown: true, title: 'Nouveau traitement' }}
      />
      <DosageKindPicker kind={kind} onChange={setKind} />
      {kind === 'AS_NEEDED' ? (
        <AsNeededTreatmentForm
          initialValue={{
            ...base,
            dosageKind: 'AS_NEEDED',
            includedInPillbox: false,
            phases: [],
            asNeededInfo: {
              maxQuantityPerDayHalfUnits: null,
              minIntervalHours: null,
            },
            controlledDispensing: null,
          }}
          submitLabel="Créer le traitement"
          onSubmit={async (draft) => {
            await createTreatment(database, draft);
            router.replace('/treatments');
          }}
        />
      ) : (
        // Une seule connexion partagée vers medication-reference.db pour
        // TreatmentForm (section délivrance encadrée, ticket 30) et la
        // confirmation d'équivalence générique après création (ticket 29) :
        // deux `SQLiteProvider` distincts avec `forceOverwrite` sur le même
        // fichier entrent en course et font planter l'import.
        <SQLiteProvider
          databaseName="medication-reference.db"
          assetSource={{
            assetId: medicationReferenceAsset,
            forceOverwrite: true,
          }}
          options={{ useNewConnection: true }}
        >
          <TreatmentForm
            personalDatabase={database}
            treatmentId={null}
            pendingEquivalenceCis={pendingEquivalences.map(
              (equivalence) => equivalence.cis,
            )}
            initialValue={{
              ...base,
              dosageKind: 'SCHEDULED',
              includedInPillbox: true,
              phases: [],
              asNeededInfo: {
                maxQuantityPerDayHalfUnits: null,
                minIntervalHours: null,
              },
              controlledDispensing: null,
            }}
            submitLabel="Créer le traitement"
            onSubmit={async (draft) => {
              const treatmentId = await createTreatment(database, draft);
              await synchronizeTreatmentIntakeReminders(database, treatmentId);
              for (const equivalence of pendingEquivalences) {
                await confirmGenericEquivalence(database, {
                  treatmentId,
                  cis: equivalence.cis,
                  specialtyName: equivalence.specialtyName,
                  groupLabel: equivalence.groupLabel,
                });
              }
              setCreatedTreatment({
                id: treatmentId,
                specialtyCis: draft.specialtyCis,
                specialtyName: draft.specialtyName,
              });
            }}
          />
          {createdTreatment ? (
            <TreatmentBoxGenericMatch
              personalDatabase={database}
              treatmentId={createdTreatment.id}
              specialtyCis={createdTreatment.specialtyCis}
              specialtyName={createdTreatment.specialtyName}
              onDone={() => router.replace('/treatments')}
            />
          ) : null}
        </SQLiteProvider>
      )}
    </ScrollView>
  );
}

function DosageKindPicker({
  kind,
  onChange,
}: {
  kind: TreatmentDosageKind;
  onChange: (kind: TreatmentDosageKind) => void;
}) {
  return (
    <View style={styles.kindPicker}>
      <AppButton
        label="Posologie planifiée"
        variant={kind === 'SCHEDULED' ? 'primary' : 'secondary'}
        onPress={() => onChange('SCHEDULED')}
      />
      <AppButton
        label="Si besoin"
        variant={kind === 'AS_NEEDED' ? 'primary' : 'secondary'}
        onPress={() => onChange('AS_NEEDED')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', flexGrow: 1, padding: 16 },
  kindPicker: { flexDirection: 'row', gap: spacing.sm },
});
