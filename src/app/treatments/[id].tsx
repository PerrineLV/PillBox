import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import { TreatmentForm } from '@/components/treatments/treatment-form';
import { confirmPermanentTreatmentDeletion } from '@/components/treatments/delete-confirmation';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  archiveTreatment,
  deleteUnusedTreatment,
  getTreatment,
  getTreatmentRemovalAction,
  reactivateTreatment,
  type TreatmentRemovalAction,
  updateTreatment,
} from '@/infrastructure/treatments/treatment-repository';

export default function EditTreatmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removalAction, setRemovalAction] =
    useState<TreatmentRemovalAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const numericId = Number(id);

  useEffect(() => {
    if (!Number.isSafeInteger(numericId)) {
      setError('Identifiant de traitement invalide.');
      return;
    }
    Promise.all([
      getTreatment(database, numericId),
      getTreatmentRemovalAction(database, numericId),
    ])
      .then(([value, action]) => {
        if (value === null) setError('Traitement introuvable.');
        else {
          setTreatment(value);
          setRemovalAction(action);
        }
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Chargement impossible.',
        ),
      );
  }, [database, numericId]);

  async function runAction(action: () => Promise<void>, notice: string) {
    setProcessing(true);
    setError(null);
    try {
      await action();
      router.replace({ pathname: '/treatments', params: { notice } });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Opération impossible.',
      );
      setProcessing(false);
    }
  }

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
      {treatment && treatment.archivedAt === null ? (
        <TreatmentForm
          initialValue={treatment}
          submitLabel="Enregistrer"
          onSubmit={async (draft) => {
            await updateTreatment(database, {
              ...draft,
              id: treatment.id,
              archivedAt: treatment.archivedAt,
            });
            router.replace('/treatments');
          }}
        />
      ) : null}
      {treatment?.archivedAt ? (
        <Text style={styles.archivedNotice}>
          Ce traitement est archivé. Ses posologies et son historique sont
          conservés.
        </Text>
      ) : null}
      {treatment && removalAction ? (
        treatment.archivedAt ? (
          <Pressable
            accessibilityRole="button"
            disabled={processing}
            onPress={() =>
              void runAction(
                () => reactivateTreatment(database, treatment.id),
                `Le traitement « ${treatment.specialtyName} » a été réactivé.`,
              )
            }
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Réactiver</Text>
          </Pressable>
        ) : removalAction === 'ARCHIVE' ? (
          <Pressable
            accessibilityRole="button"
            disabled={processing}
            onPress={() =>
              void runAction(
                () => archiveTreatment(database, treatment.id),
                `Le traitement « ${treatment.specialtyName} » a été archivé.`,
              )
            }
            style={styles.archiveAction}
          >
            <Text style={styles.archiveActionText}>Archiver</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={processing}
            onPress={() =>
              confirmPermanentTreatmentDeletion(treatment.specialtyName, () => {
                void runAction(
                  () => deleteUnusedTreatment(database, treatment.id),
                  `Le traitement « ${treatment.specialtyName} » a été supprimé.`,
                );
              })
            }
            style={styles.deleteAction}
          >
            <Text style={styles.deleteActionText}>
              Supprimer définitivement
            </Text>
          </Pressable>
        )
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', flexGrow: 1, padding: 16 },
  error: { color: '#b91c1c' },
  archiveAction: {
    borderColor: '#92400e',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    padding: 14,
  },
  archiveActionText: {
    color: '#92400e',
    fontWeight: '700',
    textAlign: 'center',
  },
  deleteAction: {
    borderColor: '#b91c1c',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    padding: 14,
  },
  deleteActionText: {
    color: '#b91c1c',
    fontWeight: '700',
    textAlign: 'center',
  },
  archivedNotice: {
    backgroundColor: '#fef3c7',
    color: '#78350f',
    marginTop: 12,
    padding: 12,
  },
  secondaryAction: {
    borderColor: '#2563eb',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    padding: 14,
  },
  secondaryActionText: {
    color: '#2563eb',
    fontWeight: '700',
    textAlign: 'center',
  },
});
