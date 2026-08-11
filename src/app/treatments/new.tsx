import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AsNeededTreatmentForm } from '@/components/treatments/as-needed-treatment-form';
import { TreatmentForm } from '@/components/treatments/treatment-form';
import type { TreatmentDosageKind } from '@/domain/treatments/treatment';
import { createTreatment } from '@/infrastructure/treatments/treatment-repository';
import { synchronizeTreatmentIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
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
          }}
          submitLabel="Créer le traitement"
          onSubmit={async (draft) => {
            await createTreatment(database, draft);
            router.replace('/treatments');
          }}
        />
      ) : (
        <TreatmentForm
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
            router.replace('/treatments');
          }}
        />
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
