import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
} from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  PrescriptionForm,
  type PrescriptionFormExistingItem,
} from '@/components/prescriptions/prescription-form';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { todayIso } from '@/domain/inventory/inventory';
import type {
  Prescription,
  PrescriptionItem,
  PrescriptionStatus,
} from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  createPrescriptionItem,
  deletePrescriptionItem,
  getPrescription,
  listPrescriptionItemsByPrescription,
  updatePrescription,
} from '@/infrastructure/prescriptions/prescription-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  Badge,
  LoadingState,
  Message,
  colors,
  spacing,
  typography,
} from '@/ui';

const STATUS_LABELS: Record<PrescriptionStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
  REPLACED: 'Remplacée',
};

const STATUS_TONES: Record<
  PrescriptionStatus,
  'success' | 'neutral' | 'warning'
> = {
  ACTIVE: 'success',
  EXPIRED: 'neutral',
  REPLACED: 'neutral',
};

export default function PrescriptionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const numericId = Number(id);
  const [prescription, setPrescription] = useState<Prescription | null>(null);
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(numericId)) {
      setError('Identifiant d’ordonnance invalide.');
      return;
    }
    try {
      const [value, values, allTreatments] = await Promise.all([
        getPrescription(database, numericId, todayIso()),
        listPrescriptionItemsByPrescription(database, numericId),
        listTreatments(database),
      ]);
      if (value === null) setError('Ordonnance introuvable.');
      else {
        setPrescription(value);
        setItems(values);
        setTreatments(allTreatments);
        setError(null);
      }
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    }
  }, [database, numericId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const treatmentById = new Map(treatments.map((item) => [item.id, item]));
  const existingItems: PrescriptionFormExistingItem[] = items
    .map((item) => {
      const treatment = treatmentById.get(item.treatmentId);
      return treatment ? { item, treatment } : null;
    })
    .filter((entry): entry is PrescriptionFormExistingItem => entry !== null);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ headerShown: true, title: 'Ordonnance' }} />
      {error ? <Message tone="error">{error}</Message> : null}
      {!error && prescription === null ? (
        <LoadingState label="Chargement de l’ordonnance…" />
      ) : null}
      {prescription ? (
        <>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={typography.title}>
              {prescription.label}
            </Text>
            <Badge
              label={STATUS_LABELS[prescription.status]}
              tone={STATUS_TONES[prescription.status]}
            />
          </View>
          {prescription.status === 'ACTIVE' ? (
            <PrescriptionEditContent
              personalDatabase={database}
              prescription={prescription}
              existingItems={existingItems}
              onReload={load}
            />
          ) : (
            <ReadOnlyPrescription
              prescription={prescription}
              existingItems={existingItems}
            />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function PrescriptionEditContent({
  personalDatabase,
  prescription,
  existingItems,
  onReload,
}: {
  personalDatabase: SQLiteDatabase;
  prescription: Prescription;
  existingItems: readonly PrescriptionFormExistingItem[];
  onReload: () => Promise<void>;
}) {
  return (
    <PrescriptionForm
      personalDatabase={personalDatabase}
      initialValue={{
        label: prescription.label,
        issueDate: prescription.issueDate,
        validUntil: prescription.validUntil,
      }}
      existingItems={existingItems}
      onRemoveExistingItem={async (itemId) => {
        await deletePrescriptionItem(personalDatabase, itemId);
        await onReload();
      }}
      submitLabel="Enregistrer les modifications"
      onSubmit={async ({ label, issueDate, validUntil, newLines }) => {
        await updatePrescription(personalDatabase, prescription.id, {
          label,
          issueDate,
          validUntil,
        });
        for (const draft of newLines) {
          await createPrescriptionItem(personalDatabase, {
            ...draft,
            prescriptionId: prescription.id,
          });
        }
        router.replace('/prescriptions');
      }}
    />
  );
}

function ReadOnlyPrescription({
  prescription,
  existingItems,
}: {
  prescription: Prescription;
  existingItems: readonly PrescriptionFormExistingItem[];
}) {
  return (
    <View style={styles.readOnly}>
      <Text>Émise le {formatLongFrenchCivilDate(prescription.issueDate)}</Text>
      <Text>
        {prescription.validUntil
          ? `Valide jusqu’au ${formatLongFrenchCivilDate(prescription.validUntil)}`
          : 'Fin de validité non renseignée'}
      </Text>
      <Message tone="info" title="Ordonnance conservée dans l’historique">
        {prescription.status === 'EXPIRED'
          ? 'Cette ordonnance n’est plus valide, mais reste consultable.'
          : 'Cette ordonnance a été remplacée par une plus récente couvrant au moins un même traitement, et reste consultable.'}
      </Message>
      <Text style={typography.heading}>Traitements couverts</Text>
      {existingItems.map(({ item, treatment }) => (
        <View key={item.id} style={styles.readOnlyItem}>
          <Text style={typography.heading}>{treatment.specialtyName}</Text>
          <Text>
            {item.quantityKind === 'DURATION'
              ? `Durée : ${item.durationDays} jour(s)`
              : `${item.boxCount} boîte(s)`}
          </Text>
          <Text>
            {item.dispensingMode === 'FRACTIONAL'
              ? `Délivrance fractionnée (${item.periodicityDays} jours)`
              : 'Délivrance complète'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  readOnly: { gap: spacing.sm },
  readOnlyItem: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 2,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
});
