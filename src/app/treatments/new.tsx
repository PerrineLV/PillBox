import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { TreatmentForm } from '@/components/treatments/treatment-form';
import type { TreatmentDraft } from '@/domain/treatments/treatment';
import { createTreatment } from '@/infrastructure/treatments/treatment-repository';

export default function NewTreatmentScreen() {
  const params = useLocalSearchParams<{
    cis?: string;
    name?: string;
    form?: string;
  }>();
  const database = useSQLiteContext();
  const router = useRouter();
  if (!params.cis || !params.name)
    return <Text>Spécialité manquante. Revenez à la recherche.</Text>;

  const initialValue: TreatmentDraft = {
    specialtyCis: params.cis,
    specialtyName: params.name,
    pharmaceuticalForm: params.form || null,
    active: true,
    includedInPillbox: true,
    phases: [],
  };
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{ headerShown: true, title: 'Nouveau traitement' }}
      />
      <TreatmentForm
        initialValue={initialValue}
        submitLabel="Créer le traitement"
        onSubmit={async (draft) => {
          await createTreatment(database, draft);
          router.replace('/treatments');
        }}
      />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', flexGrow: 1, padding: 16 },
});
