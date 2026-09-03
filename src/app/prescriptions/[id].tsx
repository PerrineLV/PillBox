import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  PrescriptionForm,
  type PrescriptionFormExistingItem,
} from '@/components/prescriptions/prescription-form';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { todayIso } from '@/domain/inventory/inventory';
import {
  isPrescriptionValidityApproaching,
  type Prescription,
  type PrescriptionItem,
  type PrescriptionStatus,
} from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  confirmPrescriptionReplacement,
  createPrescriptionItem,
  deletePrescriptionItem,
  getPrescription,
  listPrescriptionItemsByPrescription,
  updatePrescription,
} from '@/infrastructure/prescriptions/prescription-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppCard,
  AppScreen,
  Banner,
  DenseList,
  DenseRow,
  LoadingState,
  Message,
  ProgressBar,
  Section,
  SeverityBadge,
  StackHeader,
  colors,
  typography,
  type SeverityLevel,
} from '@/ui';

const STATUS_LABELS: Record<PrescriptionStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
  REPLACED: 'Remplacée',
};
/** Fenêtre affichée par la barre de validité restante. */
const VALIDITY_WINDOW_DAYS = 365;

export default function PrescriptionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const numericId = Number(id);
  const [prescription, setPrescription] = useState<Prescription | null>(null);
  const [items, setItems] = useState<PrescriptionItem[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

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
      if (value === null) {
        setError('Ordonnance introuvable.');
        return;
      }
      setPrescription(value);
      setItems(values);
      setTreatments(allTreatments);
      setError(null);
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
  const level: SeverityLevel =
    prescription === null
      ? 'neutral'
      : prescription.status !== 'ACTIVE'
        ? 'neutral'
        : isPrescriptionValidityApproaching(prescription, today)
          ? 'warning'
          : 'ok';
  const remaining =
    prescription === null
      ? null
      : remainingDays(prescription.validUntil, today);

  return (
    <AppScreen
      header={
        <StackHeader
          right={
            prescription ? (
              <SeverityBadge
                label={STATUS_LABELS[prescription.status]}
                level={level}
              />
            ) : undefined
          }
          subtitle={
            prescription
              ? `Émise le ${formatLongFrenchCivilDate(prescription.issueDate)}`
              : undefined
          }
          title={prescription?.label ?? 'Ordonnance'}
        />
      }
    >
      {error ? <Message tone="error">{error}</Message> : null}
      {!error && prescription === null ? (
        <LoadingState label="Chargement de l’ordonnance…" />
      ) : null}

      {prescription ? (
        <>
          <AppCard>
            <Text style={typography.sectionLabel}>Validité restante</Text>
            <Text style={styles.validity}>
              {remaining === null
                ? 'Non renseignée'
                : remaining > 0
                  ? `${remaining} jour${remaining > 1 ? 's' : ''}`
                  : 'Validité dépassée'}
            </Text>
            {remaining !== null ? (
              <ProgressBar
                color={colors.brand}
                height={6}
                ratio={remaining / VALIDITY_WINDOW_DAYS}
              />
            ) : null}
            <Text style={typography.detail}>
              {prescription.validUntil
                ? `Valide jusqu’au ${formatLongFrenchCivilDate(prescription.validUntil)}`
                : 'Fin de validité non renseignée : aucune date n’est déduite.'}
            </Text>
          </AppCard>

          <Section
            aside={String(existingItems.length)}
            label="Traitements couverts"
          >
            {existingItems.length === 0 ? (
              <Text style={typography.detail}>
                Aucun traitement rattaché à cette ordonnance.
              </Text>
            ) : (
              <DenseList>
                {existingItems.map(({ item, treatment }, index) => (
                  <DenseRow
                    detail={
                      item.dispensingMode === 'FRACTIONAL'
                        ? `Délivrance fractionnée tous les ${item.periodicityDays} jours`
                        : 'Délivrance complète'
                    }
                    first={index === 0}
                    key={item.id}
                    title={
                      <Text style={styles.itemName}>
                        {treatment.specialtyName}
                      </Text>
                    }
                    trailing={
                      <Text style={styles.quantity}>
                        {item.quantityKind === 'DURATION'
                          ? `${item.durationDays} jours`
                          : `${item.boxCount} boîte${(item.boxCount ?? 0) > 1 ? 's' : ''}`}
                      </Text>
                    }
                  />
                ))}
              </DenseList>
            )}
          </Section>

          {prescription.status === 'ACTIVE' ? (
            <Section label="Modifier">
              <PrescriptionEditContent
                existingItems={existingItems}
                onReload={load}
                personalDatabase={database}
                prescription={prescription}
              />
            </Section>
          ) : (
            <Banner level="neutral" title="Conservée dans l’historique">
              {prescription.status === 'EXPIRED'
                ? 'Cette ordonnance n’est plus valide : elle reste consultable, en lecture seule.'
                : 'Cette ordonnance a été remplacée par une plus récente couvrant au moins un même traitement. Elle reste consultable, en lecture seule.'}
            </Banner>
          )}
        </>
      ) : null}
    </AppScreen>
  );
}

function PrescriptionEditContent({
  personalDatabase,
  prescription,
  existingItems,
  onReload,
}: Readonly<{
  personalDatabase: SQLiteDatabase;
  prescription: Prescription;
  existingItems: readonly PrescriptionFormExistingItem[];
  onReload: () => Promise<void>;
}>) {
  return (
    <PrescriptionForm
      currentPrescriptionId={prescription.id}
      existingItems={existingItems}
      initialValue={{
        label: prescription.label,
        issueDate: prescription.issueDate,
        validUntil: prescription.validUntil,
      }}
      onRemoveExistingItem={async (itemId) => {
        await deletePrescriptionItem(personalDatabase, itemId);
        await onReload();
      }}
      onSubmit={async ({
        label,
        issueDate,
        validUntil,
        newLines,
        replacesPrescriptionIds,
      }) => {
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
        for (const replacedId of replacesPrescriptionIds) {
          await confirmPrescriptionReplacement(
            personalDatabase,
            replacedId,
            prescription.id,
          );
        }
        router.replace('/prescriptions');
      }}
      personalDatabase={personalDatabase}
      submitLabel="Enregistrer les modifications"
    />
  );
}

/** `null` lorsque la fin de validité n'est pas renseignée : rien n'est deviné. */
function remainingDays(
  validUntil: string | null,
  today: string,
): number | null {
  if (validUntil === null) return null;
  const end = Date.parse(`${validUntil}T12:00:00`);
  const start = Date.parse(`${today}T12:00:00`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const styles = StyleSheet.create({
  validity: {
    ...typography.numeric,
    color: colors.brand,
    fontSize: 20,
    lineHeight: 24,
  },
  itemName: { ...typography.itemTitle, fontSize: 14, lineHeight: 18 },
  quantity: {
    color: colors.brand,
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 15,
  },
});
