import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';

import { TreatmentForm } from '@/components/treatments/treatment-form';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  getTreatment,
  updateTreatment,
} from '@/infrastructure/treatments/treatment-repository';

export default function EditTreatmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const numericId = Number(id);

  useEffect(() => {
    if (!Number.isSafeInteger(numericId)) {
      setError('Identifiant de traitement invalide.');
      return;
    }
    getTreatment(database, numericId)
      .then((value) => {
        if (value === null) setError('Traitement introuvable.');
        else setTreatment(value);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Chargement impossible.',
        ),
      );
  }, [database, numericId]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{ headerShown: true, title: 'Modifier le traitement' }}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!error && treatment === null ? <ActivityIndicator /> : null}
      {treatment ? (
        <TreatmentForm
          initialValue={treatment}
          submitLabel="Enregistrer"
          onSubmit={async (draft) => {
            await updateTreatment(database, { ...draft, id: treatment.id });
            router.replace('/treatments');
          }}
        />
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', flexGrow: 1, padding: 16 },
  error: { color: '#b91c1c' },
});
