import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GenericGroupSection } from '@/components/medications/generic-group-section';
import { AsNeededTreatmentForm } from '@/components/treatments/as-needed-treatment-form';
import { TreatmentDeletionConfirmation } from '@/components/treatments/delete-confirmation';
import { TreatmentForm } from '@/components/treatments/treatment-form';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import {
  currentPhase,
  phaseFrequencySummary,
  phaseRangeLabel,
  phaseSlotQuantities,
  treatmentCategory,
  treatmentPosologySummary,
  TREATMENT_CATEGORY_LABELS,
} from '@/components/treatments/treatment-summary';
import { todayIso } from '@/domain/inventory/inventory';
import {
  formatHalfUnits,
  INTAKE_SLOTS,
  isLegacyTreatmentPhase,
  type Treatment,
} from '@/domain/treatments/treatment';
import {
  forgetGenericEquivalence,
  listGenericEquivalenceConfirmations,
  type GenericEquivalenceConfirmation,
} from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  synchronizeIntakeReminders,
  synchronizeTreatmentIntakeReminders,
} from '@/infrastructure/reminders/intake-reminder-scheduler';
import {
  archiveTreatment,
  deleteUnusedTreatment,
  getTreatment,
  getTreatmentRemovalAction,
  restoreArchivedTreatment,
  updateTreatment,
  type TreatmentRemovalAction,
} from '@/infrastructure/treatments/treatment-repository';
import {
  AppCard,
  AppScreen,
  Banner,
  DenseList,
  DenseRow,
  INTAKE_SLOT_LABELS,
  LoadingState,
  Message,
  MetaBadge,
  PillButton,
  Section,
  SeverityBadge,
  StackHeader,
  colors,
  radii,
  typography,
  useToast,
} from '@/ui';

export default function TreatmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const { showToast } = useToast();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removalAction, setRemovalAction] =
    useState<TreatmentRemovalAction | null>(null);
  const [equivalences, setEquivalences] = useState<
    GenericEquivalenceConfirmation[]
  >([]);
  const [processing, setProcessing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] =
    useState(false);
  const numericId = Number(id);
  const today = todayIso();

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(numericId)) {
      setError('Identifiant de traitement invalide.');
      return;
    }
    const [value, action, confirmations] = await Promise.all([
      getTreatment(database, numericId),
      getTreatmentRemovalAction(database, numericId),
      listGenericEquivalenceConfirmations(database, numericId),
    ]);
    if (value === null) {
      setError('Traitement introuvable.');
      return;
    }
    setTreatment(value);
    setRemovalAction(action);
    setEquivalences(confirmations);
    setError(null);
  }, [database, numericId]);

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      ),
    );
  }, [load]);

  async function forgetEquivalence(cis: string): Promise<void> {
    try {
      await forgetGenericEquivalence(database, numericId, cis);
      setEquivalences((previous) =>
        previous.filter((item) => item.cis !== cis),
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Oubli impossible.');
    }
  }

  /**
   * L'écran est quitté aussitôt : la confirmation passe par un toast, qui
   * survit à la navigation, plutôt que par un bandeau déposé sur la liste et
   * qui y resterait indéfiniment.
   */
  async function runAction(
    action: () => Promise<void>,
    notice: string,
  ): Promise<void> {
    setProcessing(true);
    setError(null);
    try {
      await action();
      await synchronizeTreatmentIntakeReminders(database, numericId);
      router.replace('/treatments');
      showToast(notice, 'success');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Opération impossible.',
      );
      setProcessing(false);
    }
  }

  const phase = treatment ? currentPhase(treatment, today) : null;
  const quantities = phaseSlotQuantities(phase);

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle={treatment?.pharmaceuticalForm ?? undefined}
          title={treatment?.specialtyName ?? 'Traitement'}
        />
      }
    >
      {error ? <Message tone="error">{error}</Message> : null}
      {!error && treatment === null ? (
        <LoadingState label="Chargement du traitement…" />
      ) : null}

      {treatment ? (
        <>
          <AppCard>
            <View style={styles.badges}>
              <SeverityBadge
                label={TREATMENT_CATEGORY_LABELS[treatmentCategory(treatment)]}
                level="ok"
              />
              <MetaBadge label={`CIS ${treatment.specialtyCis}`} />
              {treatment.archivedAt ? (
                <SeverityBadge label="Archivé" level="neutral" />
              ) : null}
            </View>
            <Text style={styles.posology}>
              {treatmentPosologySummary(treatment)}
            </Text>
            {treatment.dosageKind === 'SCHEDULED' ? (
              <View style={styles.slotTiles}>
                {INTAKE_SLOTS.map((slot) => {
                  const served = quantities[slot] > 0;
                  return (
                    <View
                      accessibilityLabel={`${INTAKE_SLOT_LABELS[slot]} : ${
                        served
                          ? `${formatHalfUnits(quantities[slot])} unité(s)`
                          : 'non servi'
                      }`}
                      key={slot}
                      style={[styles.slotTile, served && styles.slotTileServed]}
                    >
                      <Text style={styles.slotLabel}>
                        {INTAKE_SLOT_LABELS[slot]}
                      </Text>
                      <Text
                        style={[
                          styles.slotValue,
                          served ? styles.slotValueServed : null,
                        ]}
                      >
                        {served ? formatHalfUnits(quantities[slot]) : '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </AppCard>

          {treatment.archivedAt ? (
            <Banner level="warning" title="Traitement archivé">
              Ses posologies et son historique sont conservés.
            </Banner>
          ) : null}

          {treatment.phases.length > 0 ? (
            <Section
              aside={String(treatment.phases.length)}
              label="Phases de posologie"
            >
              <DenseList>
                {treatment.phases.map((item, index) => {
                  const active = phase !== null && item.id === phase.id;
                  return (
                    <DenseRow
                      detail={phaseFrequencySummary(item)}
                      first={index === 0}
                      key={item.id ?? index}
                      leading={
                        <View
                          style={[styles.dot, active && styles.dotActive]}
                        />
                      }
                      title={
                        <Text style={styles.phaseRange}>
                          {phaseRangeLabel(item, formatLongFrenchCivilDate)}
                        </Text>
                      }
                    />
                  );
                })}
              </DenseList>
              {treatment.phases.some(isLegacyTreatmentPhase) ? (
                <Text style={typography.micro}>
                  Une posologie sans dates provient d’un enregistrement
                  antérieur aux phases datées : elle est conservée telle quelle.
                </Text>
              ) : null}
            </Section>
          ) : null}

          {equivalences.length > 0 ? (
            <Section label="Équivalences génériques confirmées">
              <DenseList>
                {equivalences.map((confirmation, index) => (
                  <DenseRow
                    detail={`CIS ${confirmation.cis} · confirmée le ${formatFrenchDateTime(confirmation.confirmedAt)}`}
                    first={index === 0}
                    key={confirmation.cis}
                    title={
                      <Text style={styles.equivalenceName}>
                        {confirmation.specialtyName}
                      </Text>
                    }
                    trailing={
                      <Pressable
                        accessibilityLabel={`Oublier l’équivalence ${confirmation.specialtyName}`}
                        accessibilityRole="button"
                        onPress={() => void forgetEquivalence(confirmation.cis)}
                        style={({ pressed }) => pressed && styles.pressed}
                      >
                        <Text style={styles.forget}>Oublier</Text>
                      </Pressable>
                    }
                  />
                ))}
              </DenseList>
              <Text style={typography.micro}>
                Les oublier ne modifie pas l’historique déjà enregistré : la
                prochaine vérification de ce CIS redemandera une confirmation.
              </Text>
            </Section>
          ) : null}

          <GenericGroupSection cis={treatment.specialtyCis} />

          {treatment.archivedAt === null ? (
            <Section label="Modifier la posologie">
              <DenseList tone="muted">
                <DenseRow
                  accessibilityLabel={
                    editing
                      ? 'Masquer le formulaire de posologie'
                      : 'Modifier la posologie'
                  }
                  chevron
                  detail="Une nouvelle phase remplace la précédente sans réécrire l’historique."
                  first
                  onPress={() => setEditing((current) => !current)}
                  title={editing ? 'Masquer le formulaire' : 'Modifier'}
                />
              </DenseList>
              {editing ? (
                treatment.dosageKind === 'AS_NEEDED' ? (
                  <AsNeededTreatmentForm
                    initialValue={treatment}
                    onSubmit={async (draft) => {
                      await updateTreatment(database, {
                        ...draft,
                        id: treatment.id,
                        archivedAt: treatment.archivedAt,
                      });
                      router.replace('/treatments');
                    }}
                    submitLabel="Enregistrer les modifications"
                  />
                ) : (
                  <TreatmentForm
                    initialValue={treatment}
                    onSubmit={async (draft) => {
                      await updateTreatment(database, {
                        ...draft,
                        id: treatment.id,
                        archivedAt: treatment.archivedAt,
                      });
                      await synchronizeTreatmentIntakeReminders(
                        database,
                        treatment.id,
                      );
                      router.replace('/treatments');
                    }}
                    personalDatabase={database}
                    submitLabel="Enregistrer les modifications"
                    treatmentId={treatment.id}
                  />
                )
              ) : null}
            </Section>
          ) : null}

          <View style={styles.actions}>
            <PillButton
              height={46}
              label="Voir la chronologie"
              onPress={() =>
                router.push({
                  pathname: '/history',
                  params: { treatmentId: String(treatment.id) },
                })
              }
              tone="outline"
            />
            {removalAction ? (
              treatment.archivedAt ? (
                <PillButton
                  disabled={processing}
                  height={46}
                  label="Restaurer le traitement"
                  onPress={() =>
                    void runAction(
                      () => restoreArchivedTreatment(database, treatment.id),
                      `Le traitement « ${treatment.specialtyName} » a été restauré.`,
                    )
                  }
                  tone="outline"
                />
              ) : removalAction === 'ARCHIVE' ? (
                <PillButton
                  disabled={processing}
                  height={46}
                  label="Archiver le traitement"
                  onPress={() =>
                    void runAction(
                      () => archiveTreatment(database, treatment.id),
                      `Le traitement « ${treatment.specialtyName} » a été archivé.`,
                    )
                  }
                  tone="outline"
                />
              ) : (
                <PillButton
                  disabled={processing}
                  height={46}
                  label="Supprimer définitivement"
                  onPress={() => setDeleteConfirmationVisible(true)}
                  tone="destructive"
                />
              )
            ) : null}
            <Text style={typography.micro}>
              Un traitement déjà utilisé dans une préparation est archivé,
              jamais supprimé.
            </Text>
          </View>

          <TreatmentDeletionConfirmation
            onCancel={() => setDeleteConfirmationVisible(false)}
            onConfirm={() => {
              setDeleteConfirmationVisible(false);
              void runAction(async () => {
                await deleteUnusedTreatment(database, treatment.id);
                await synchronizeIntakeReminders(database);
              }, `Le traitement « ${treatment.specialtyName} » a été supprimé.`);
            }}
            treatmentName={treatment.specialtyName}
            visible={deleteConfirmationVisible}
          />
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 9 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  posology: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  slotTiles: { flexDirection: 'row', gap: 7 },
  slotTile: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    flex: 1,
    gap: 4,
    paddingVertical: 10,
  },
  slotTileServed: { backgroundColor: colors.brandSoft },
  slotLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  slotValue: {
    ...typography.numeric,
    color: '#C9C4B8',
    fontSize: 15,
    lineHeight: 18,
  },
  slotValueServed: { color: colors.brandPressed },
  dot: {
    backgroundColor: colors.textTertiary,
    borderRadius: radii.pill,
    height: 8,
    width: 8,
  },
  dotActive: { backgroundColor: colors.brand },
  phaseRange: { ...typography.itemTitle, fontSize: 13.5, lineHeight: 17 },
  equivalenceName: {
    ...typography.itemTitle,
    fontSize: 13.5,
    lineHeight: 17,
  },
  forget: {
    color: colors.destructive,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  pressed: { opacity: 0.72 },
});
