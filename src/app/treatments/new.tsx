import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  type Href,
} from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TreatmentBoxGenericMatch } from '@/components/medications/treatment-box-generic-match';
import { AsNeededTreatmentForm } from '@/components/treatments/as-needed-treatment-form';
import { TreatmentForm } from '@/components/treatments/treatment-form';
import type { TreatmentDosageKind } from '@/domain/treatments/treatment';
import { queueCreatedTreatmentForPrescription } from '@/infrastructure/prescriptions/pending-new-treatment-for-prescription';
import { synchronizeTreatmentIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { confirmGenericEquivalence } from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  drainPendingGenericEquivalenceDrafts,
  type PendingGenericEquivalenceDraft,
} from '@/infrastructure/treatments/pending-generic-equivalence-draft';
import { createTreatment } from '@/infrastructure/treatments/treatment-repository';
import { AppButton, colors, spacing } from '@/ui';

type SpecialtyBase = {
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
};

export default function NewTreatmentScreen() {
  const params = useLocalSearchParams<{
    cis?: string;
    name?: string;
    form?: string;
    /**
     * Présent lorsque cet écran est atteint depuis une ligne d'ordonnance
     * (ticket 46) : le traitement créé doit revenir vers cet écran plutôt
     * que vers la liste des traitements, sans perdre le brouillon
     * d'ordonnance déjà saisi (voir `PrescriptionForm`).
     */
    returnTo?: string;
  }>();
  const database = useSQLiteContext();
  const router = useRouter();

  // `dismissTo` plutôt que `replace` : cet écran est toujours atteint via
  // `/medications/search` (poussé par-dessus la liste des traitements), que
  // `replace` laisserait dans la pile sous le nouvel écran remplacé. `dismissTo`
  // dépile jusqu'à l'écran des traitements déjà existant plus bas dans la
  // pile, qu'il s'agisse du cas normal ou du retour vers une ordonnance en
  // cours (ticket 46).
  function finishTreatmentCreation(treatmentId: number): void {
    if (params.returnTo) {
      queueCreatedTreatmentForPrescription(treatmentId);
      router.dismissTo(params.returnTo as Href);
      return;
    }
    router.dismissTo('/treatments');
  }
  const [kind, setKind] = useState<TreatmentDosageKind>('SCHEDULED');

  if (!params.cis || !params.name)
    return <Text>Spécialité manquante. Revenez à la recherche.</Text>;

  const base: SpecialtyBase = {
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
          }}
          submitLabel="Créer le traitement"
          onSubmit={async (draft) => {
            const treatmentId = await createTreatment(database, draft);
            finishTreatmentCreation(treatmentId);
          }}
        />
      ) : (
        <ScheduledTreatmentCreation
          database={database}
          base={base}
          finishTreatmentCreation={finishTreatmentCreation}
        />
      )}
    </ScrollView>
  );
}

function ScheduledTreatmentCreation({
  database,
  base,
  finishTreatmentCreation,
}: {
  database: SQLiteDatabase;
  base: SpecialtyBase;
  finishTreatmentCreation: (treatmentId: number) => void;
}) {
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

  return (
    <>
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
          onDone={() => finishTreatmentCreation(createdTreatment.id)}
        />
      ) : null}
    </>
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
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
  },
  kindPicker: { flexDirection: 'row', gap: spacing.sm },
});
