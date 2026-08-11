import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { AsNeededIntakeLog } from '@/components/treatments/as-needed-intake-log';
import { AsNeededTreatmentForm } from '@/components/treatments/as-needed-treatment-form';
import { TreatmentForm } from '@/components/treatments/treatment-form';
import { TreatmentDeletionConfirmation } from '@/components/treatments/delete-confirmation';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  archiveTreatment,
  deleteUnusedTreatment,
  getTreatment,
  getTreatmentRemovalAction,
  restoreArchivedTreatment,
  type TreatmentRemovalAction,
  updateTreatment,
} from '@/infrastructure/treatments/treatment-repository';
import {
  synchronizeIntakeReminders,
  synchronizeTreatmentIntakeReminders,
} from '@/infrastructure/reminders/intake-reminder-scheduler';
import { AppButton, LoadingState, Message, colors, spacing } from '@/ui';

export default function EditTreatmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removalAction, setRemovalAction] =
    useState<TreatmentRemovalAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] =
    useState(false);
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
      await synchronizeTreatmentIntakeReminders(database, numericId);
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
      {error ? <Message tone="error">{error}</Message> : null}
      {!error && treatment === null ? (
        <LoadingState label="Chargement du traitement…" />
      ) : null}
      {treatment && treatment.archivedAt === null ? (
        treatment.dosageKind === 'AS_NEEDED' ? (
          <AsNeededTreatmentForm
            initialValue={treatment}
            submitLabel="Enregistrer les modifications"
            onSubmit={async (draft) => {
              await updateTreatment(database, {
                ...draft,
                id: treatment.id,
                archivedAt: treatment.archivedAt,
              });
              router.replace('/treatments');
            }}
          />
        ) : (
          <TreatmentForm
            initialValue={treatment}
            submitLabel="Enregistrer les modifications"
            onSubmit={async (draft) => {
              await updateTreatment(database, {
                ...draft,
                id: treatment.id,
                archivedAt: treatment.archivedAt,
              });
              await synchronizeTreatmentIntakeReminders(database, treatment.id);
              router.replace('/treatments');
            }}
          />
        )
      ) : null}
      {treatment?.archivedAt ? (
        <Message tone="warning" title="Traitement archivé">
          Ses posologies et son historique sont conservés.
        </Message>
      ) : null}
      {treatment ? (
        <AppButton
          label="Voir la chronologie"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/history',
              params: { treatmentId: String(treatment.id) },
            })
          }
        />
      ) : null}
      {treatment?.dosageKind === 'AS_NEEDED' ? (
        <AsNeededIntakeLog
          treatmentId={treatment.id}
          canRecord={treatment.archivedAt === null}
        />
      ) : null}
      {treatment && removalAction ? (
        treatment.archivedAt ? (
          <AppButton
            label="Restaurer le traitement"
            variant="secondary"
            loading={processing}
            onPress={() =>
              void runAction(
                () => restoreArchivedTreatment(database, treatment.id),
                `Le traitement « ${treatment.specialtyName} » a été restauré.`,
              )
            }
          />
        ) : removalAction === 'ARCHIVE' ? (
          <AppButton
            label="Archiver le traitement"
            variant="secondary"
            loading={processing}
            onPress={() =>
              void runAction(
                () => archiveTreatment(database, treatment.id),
                `Le traitement « ${treatment.specialtyName} » a été archivé.`,
              )
            }
          />
        ) : (
          <AppButton
            label="Supprimer définitivement"
            variant="danger"
            loading={processing}
            onPress={() => setDeleteConfirmationVisible(true)}
          />
        )
      ) : null}
      {treatment ? (
        <TreatmentDeletionConfirmation
          visible={deleteConfirmationVisible}
          treatmentName={treatment.specialtyName}
          onCancel={() => setDeleteConfirmationVisible(false)}
          onConfirm={() => {
            setDeleteConfirmationVisible(false);
            void runAction(async () => {
              await deleteUnusedTreatment(database, treatment.id);
              await synchronizeIntakeReminders(database);
            }, `Le traitement « ${treatment.specialtyName} » a été supprimé.`);
          }}
        />
      ) : null}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
});
