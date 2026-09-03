import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AsNeededList } from '@/components/home/as-needed-list';
import { HomeHeader } from '@/components/home/home-header';
import { WatchList } from '@/components/home/watch-list';
import {
  WeeklyPillboxCard,
  type WeeklyPreparationState,
} from '@/components/home/weekly-pillbox-card';
import { buildWeeklyPillbox } from '@/components/home/weekly-pillbox';
import {
  isWatchAttentionItem,
  type WatchAttentionItem,
} from '@/components/home/watch-item-labels';
import { OutsidePillboxIntakeBoxChoice } from '@/components/intakes/outside-pillbox-intake-box-choice';
import { buildInventoryAlerts } from '@/domain/alerts/inventory-alerts';
import { buildStockForecast } from '@/domain/forecast/stock-forecast';
import {
  buildAttentionItems,
  NEXT_INTAKE_LOOKAHEAD_DAYS,
  type AsNeededTreatmentInput,
  type AttentionItem,
} from '@/domain/home/attention-items';
import {
  buildAsNeededRows,
  type AsNeededRow,
} from '@/domain/home/as-needed-section';
import {
  buildTodaySlots,
  focusTodaySlot,
  type TodaySlotEntry,
} from '@/domain/home/today-plan';
import type { WeeklyGrid } from '@/domain/home/weekly-grid';
import { intakesOnLocalDay } from '@/domain/intakes/as-needed-availability';
import { snapshotGeneratedIntake } from '@/domain/intakes/intake-tracking';
import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import { todayIso } from '@/domain/inventory/inventory';
import {
  localCivilDate,
  startOfLocalDay,
} from '@/domain/reminders/intake-reminder';
import { buildRenewalList } from '@/domain/renewal/renewal-list';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import { INTAKE_SLOTS, type Treatment } from '@/domain/treatments/treatment';
import { useDatabaseTaskQueue } from '@/infrastructure/database/database-provider';
import type { SerialTaskQueue } from '@/infrastructure/database/serial-task-queue';
import {
  deleteAsNeededIntake,
  getLastAsNeededIntake,
  listAsNeededIntakesInRange,
  recordAsNeededIntake,
} from '@/infrastructure/intakes/as-needed-intake-repository';
import {
  listIntakeRecordsForGroups,
  listPendingIntakeCounts,
  markPendingIntakesTaken,
  materializeIntakeSnapshots,
  updateIntakeStatus,
} from '@/infrastructure/intakes/intake-repository';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  getLatestDraftPreparation,
  listPreparationWeeks,
} from '@/infrastructure/preparations/preparation-repository';
import { listPrescriptions } from '@/infrastructure/prescriptions/prescription-repository';
import {
  getGlobalIntakeReminderSettings,
  isIntakeRemindersEnabled,
} from '@/infrastructure/reminders/intake-reminder-repository';
import { getPreparationReminderSettings } from '@/infrastructure/reminders/preparation-reminder-repository';
import { listAllGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { LoadingState, Message, Section, colors, layout, useToast } from '@/ui';

/**
 * Nombre d'alertes montrées avant de renvoyer au suivi détaillé : au-delà,
 * l'accueil cesserait de répondre à « qu'est-ce que j'ai à faire maintenant ».
 * Le même plafond borne la section « si besoin », dont la hauteur ne doit pas
 * dépendre du nombre de traitements de l'ordonnance.
 */
const MAX_WATCH_ITEMS = 3;

/**
 * Quantité enregistrée par le geste rapide de l'accueil : une unité, la même
 * valeur par défaut que la fiche de prise. Toute autre quantité se saisit sur
 * cette fiche — l'accueil ne déduit jamais une posologie.
 */
const QUICK_INTAKE_HALF_UNITS = 2;

export type HomeData = Readonly<{
  slots: readonly TodaySlotEntry[];
  watchItems: readonly WatchAttentionItem[];
  asNeededRows: readonly AsNeededRow[];
  grid: WeeklyGrid | null;
  preparationState: WeeklyPreparationState;
  outsidePillboxTreatmentIds: ReadonlySet<number>;
}>;

export default function HomeScreen() {
  const database = useSQLiteContext();
  const queue = useDatabaseTaskQueue();
  const { showToast } = useToast();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [boxChoiceRecord, setBoxChoiceRecord] = useState<IntakeRecord | null>(
    null,
  );

  const load = useCallback(async (): Promise<HomeData> => {
    const reference = new Date();
    setNow(reference);
    const today = todayIso();
    const treatments = await listTreatments(database);
    await materializeTodayIntakes(queue, database, treatments, today);
    const lookaheadEnd = new Date(reference);
    lookaheadEnd.setDate(lookaheadEnd.getDate() + NEXT_INTAKE_LOOKAHEAD_DAYS);
    const [
      boxes,
      draft,
      weeks,
      remindersEnabled,
      slotTimes,
      preparationReminder,
      pendingIntakeCounts,
      equivalenceConfirmations,
      prescriptions,
      todayRecords,
      todayAsNeededIntakes,
    ] = await Promise.all([
      listMedicationBoxes(database),
      getLatestDraftPreparation(database),
      listPreparationWeeks(database),
      isIntakeRemindersEnabled(database),
      getGlobalIntakeReminderSettings(database),
      getPreparationReminderSettings(database),
      listPendingIntakeCounts(
        database,
        localCivilDate(reference),
        localCivilDate(lookaheadEnd),
      ),
      listAllGenericEquivalenceConfirmations(database),
      listPrescriptions(database, today),
      listIntakeRecordsForGroups(database, today, INTAKE_SLOTS),
      listAsNeededIntakesInRange(database, {
        startAt: startOfLocalDay(today).toISOString(),
        endAt: reference.toISOString(),
        treatmentId: null,
      }),
    ]);

    const asNeededTreatments = treatments.filter(
      (treatment) =>
        treatment.dosageKind === 'AS_NEEDED' && treatment.archivedAt === null,
    );
    const lastIntakes = await Promise.all(
      asNeededTreatments.map((treatment) =>
        getLastAsNeededIntake(database, treatment.id),
      ),
    );
    const equivalences = equivalenceConfirmations.map((confirmation) => ({
      treatmentId: confirmation.treatmentId,
      cis: confirmation.cis,
    }));
    const forecast = buildStockForecast(treatments, boxes, today, weeks, {
      equivalences,
    });
    const asNeededInputs: AsNeededTreatmentInput[] = asNeededTreatments.map(
      (treatment, index) => ({
        treatmentId: treatment.id,
        specialtyName: treatment.specialtyName,
        maxQuantityPerDayHalfUnits:
          treatment.asNeededInfo.maxQuantityPerDayHalfUnits,
        minIntervalHours: treatment.asNeededInfo.minIntervalHours,
        lastIntake: lastIntakes[index],
      }),
    );
    const items = buildAttentionItems({
      referenceDate: today,
      now: reference,
      intakeRemindersEnabled: remindersEnabled,
      preparationReminder,
      treatments,
      intakeSlotTimes: slotTimes,
      pendingIntakeCounts,
      draftPreparation: draft
        ? {
            startDate: draft.snapshot.startDate,
            endDate: draft.snapshot.endDate,
            completedCount: draft.progress.length,
            totalCount: draft.snapshot.requirements.length,
          }
        : null,
      knownPreparationWeeks: weeks,
      renewalItems: buildRenewalList(forecast),
      expirations: buildInventoryAlerts(treatments, boxes, today, {
        equivalences,
      }).expirations,
      asNeededTreatments: asNeededInputs,
      prescriptions,
    });

    const pillbox = buildWeeklyPillbox({
      preparation: items.find(
        (item): item is Extract<AttentionItem, { type: 'PREPARATION' }> =>
          item.type === 'PREPARATION',
      ),
      draft,
      treatments,
    });

    return {
      slots: buildTodaySlots(todayRecords, slotTimes),
      watchItems: items.filter(isWatchAttentionItem),
      asNeededRows: buildAsNeededRows(
        asNeededTreatments.map((treatment, index) => ({
          treatmentId: treatment.id,
          specialtyName: treatment.specialtyName,
          limits: treatment.asNeededInfo,
          intakesToday: intakesOnLocalDay(
            todayAsNeededIntakes.filter(
              (intake) => intake.treatmentId === treatment.id,
            ),
            reference,
          ),
          lastIntake: lastIntakes[index],
        })),
        reference,
      ),
      grid: pillbox?.grid ?? null,
      preparationState: pillbox?.state ?? 'TO_PREPARE',
      outsidePillboxTreatmentIds: new Set(
        treatments
          .filter(
            (treatment) =>
              treatment.dosageKind === 'SCHEDULED' &&
              !treatment.includedInPillbox,
          )
          .map((treatment) => treatment.id),
      ),
    };
  }, [database, queue]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setData(await load());
      setError(null);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Chargement de votre situation impossible.',
      );
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void refresh().finally(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [refresh]),
  );

  async function toggleIntake(record: IntakeRecord): Promise<void> {
    if (
      record.status !== 'TAKEN' &&
      data?.outsidePillboxTreatmentIds.has(record.treatmentId)
    ) {
      setBoxChoiceRecord(record);
      return;
    }
    setBusy(true);
    setError(null);
    const taken = record.status === 'TAKEN';
    try {
      await updateIntakeStatus(database, record.key, taken ? 'UNSET' : 'TAKEN');
      await refresh();
      // Sans « Annuler » : la case est elle-même son propre retour en arrière,
      // et elle reste sous les yeux au moment où le toast s'affiche.
      showToast(
        taken
          ? `Prise remise en attente : ${record.specialtyName}.`
          : `Prise validée : ${record.specialtyName}.`,
        'success',
      );
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * La validation groupée touche plusieurs prises d'un seul geste : elle est
   * la seule des deux à mériter un « Annuler », qui remet en attente
   * exactement celles qui l'étaient avant — jamais celles déjà renseignées.
   */
  async function validateSlot(entry: TodaySlotEntry): Promise<void> {
    const date = entry.records[0]?.date;
    if (date === undefined) return;
    const pendingKeys = entry.records
      .filter((record) => record.status === 'UNSET')
      .map((record) => record.key);
    setBusy(true);
    setError(null);
    try {
      await markPendingIntakesTaken(database, date, entry.slot);
      await refresh();
      showToast(
        pendingKeys.length === 1
          ? 'Prise validée.'
          : `${pendingKeys.length} prises validées.`,
        'success',
        { label: 'Annuler', onPress: () => void undoSlot(pendingKeys) },
      );
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Validation impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function undoSlot(keys: readonly string[]): Promise<void> {
    setBusy(true);
    try {
      for (const key of keys) await updateIntakeStatus(database, key, 'UNSET');
      await refresh();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Annulation impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Le geste principal reste sur place : la prise est écrite immédiatement,
   * sans navigation ni confirmation préalable. Le retour en arrière est offert
   * par le toast plutôt que par une question posée avant l'action.
   */
  async function recordAsNeeded(row: AsNeededRow): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const intakeId = await recordAsNeededIntake(database, {
        treatmentId: row.treatmentId,
        takenAt: new Date().toISOString(),
        quantityHalfUnits: QUICK_INTAKE_HALF_UNITS,
        note: null,
      });
      await refresh();
      showToast(`Prise enregistrée : ${row.specialtyName}.`, 'success', {
        label: 'Annuler',
        onPress: () => void undoAsNeeded(intakeId),
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function undoAsNeeded(intakeId: number): Promise<void> {
    setBusy(true);
    try {
      await deleteAsNeededIntake(database, intakeId);
      await refresh();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Annulation impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StatusBar style="light" />
      <HomeContent
        busy={busy}
        data={data}
        error={error}
        loading={loading}
        now={now}
        onRecordAsNeeded={(row) => void recordAsNeeded(row)}
        onToggleIntake={(record) => void toggleIntake(record)}
        onValidateSlot={(entry) => void validateSlot(entry)}
      />
      <OutsidePillboxIntakeBoxChoice
        database={database}
        record={boxChoiceRecord}
        onCancel={() => setBoxChoiceRecord(null)}
        onTaken={async () => {
          setBoxChoiceRecord(null);
          await refresh();
        }}
      />
    </>
  );
}

export function HomeContent({
  data,
  loading,
  error,
  now,
  busy = false,
  onRecordAsNeeded = () => undefined,
  onToggleIntake = () => undefined,
  onValidateSlot = () => undefined,
}: Readonly<{
  data: HomeData | null;
  loading: boolean;
  error: string | null;
  now: Date;
  busy?: boolean;
  onRecordAsNeeded?: (row: AsNeededRow) => void;
  onToggleIntake?: (record: IntakeRecord) => void;
  onValidateSlot?: (entry: TodaySlotEntry) => void;
}>) {
  const insets = useSafeAreaInsets();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slots = data?.slots ?? [];
  const focus = focusTodaySlot(slots, nowMinutes);
  const watchItems = data?.watchItems ?? [];
  const visibleWatchItems = watchItems.slice(0, MAX_WATCH_ITEMS);
  const asNeededRows = data?.asNeededRows ?? [];
  const visibleAsNeededRows = asNeededRows.slice(0, MAX_WATCH_ITEMS);
  return (
    <View style={styles.screen}>
      <View style={[styles.topInset, { height: insets.top }]} />
      <HomeHeader
        busy={busy}
        entry={focus}
        hasAlerts={watchItems.length > 0}
        nowMinutes={nowMinutes}
        onToggle={onToggleIntake}
        onValidateAll={onValidateSlot}
        outsidePillboxTreatmentIds={
          data?.outsidePillboxTreatmentIds ?? new Set()
        }
      />
      <ScrollView contentContainerStyle={styles.body} style={styles.bodyScroll}>
        {loading && data === null ? (
          <LoadingState label="Chargement de votre situation…" />
        ) : null}
        {error ? (
          <Message tone="error" title="Situation indisponible">
            {error}
          </Message>
        ) : null}
        {visibleAsNeededRows.length > 0 ? (
          <Section aside={String(asNeededRows.length)} label="Si besoin">
            <AsNeededList
              busy={busy}
              extraCount={asNeededRows.length - visibleAsNeededRows.length}
              onRecord={onRecordAsNeeded}
              rows={visibleAsNeededRows}
            />
          </Section>
        ) : null}
        {visibleWatchItems.length > 0 ? (
          <Section aside={String(watchItems.length)} label="À surveiller">
            <WatchList items={visibleWatchItems} />
          </Section>
        ) : null}
        {data?.grid ? (
          <Section label="Pilulier de la semaine">
            <WeeklyPillboxCard grid={data.grid} state={data.preparationState} />
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Les prises du jour ne sont matérialisées que par la programmation des
 * rappels. Sans rappel activé, l'accueil n'aurait rien à cocher : la même
 * matérialisation est donc rejouée ici. L'opération est idempotente et ne
 * réécrit jamais une prise déjà renseignée.
 */
async function materializeTodayIntakes(
  queue: SerialTaskQueue,
  database: SQLiteDatabase,
  treatments: readonly Treatment[],
  today: string,
): Promise<void> {
  const forms = new Map(
    treatments.map((treatment) => [treatment.id, treatment.pharmaceuticalForm]),
  );
  const snapshots = generateIntakes(treatments, today, today, {
    includeTreatmentsOutsidePillbox: true,
  }).map((intake) =>
    snapshotGeneratedIntake(intake, forms.get(intake.treatmentId) ?? null),
  );
  if (snapshots.length === 0) return;
  await queue.run(() => materializeIntakeSnapshots(database, snapshots));
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  topInset: { backgroundColor: colors.headerDark },
  bodyScroll: { flex: 1, minHeight: 0 },
  body: {
    gap: layout.sectionGap,
    paddingBottom: 22,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 18,
  },
});
