import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttentionItemCard } from '@/components/home/attention-item-card';
import { buildInventoryAlerts } from '@/domain/alerts/inventory-alerts';
import { buildStockForecast } from '@/domain/forecast/stock-forecast';
import {
  buildAttentionItems,
  isAttentionItemActionRequired,
  NEXT_INTAKE_LOOKAHEAD_DAYS,
  type AsNeededTreatmentInput,
  type AttentionItem,
} from '@/domain/home/attention-items';
import { todayIso } from '@/domain/inventory/inventory';
import { localCivilDate } from '@/domain/reminders/intake-reminder';
import { buildRenewalList } from '@/domain/renewal/renewal-list';
import { getLastAsNeededIntake } from '@/infrastructure/intakes/as-needed-intake-repository';
import { listPendingIntakeCounts } from '@/infrastructure/intakes/intake-repository';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  getLatestDraftPreparation,
  listPreparationHistory,
  listPreparationWeeks,
  type PreparationHistoryEntry,
} from '@/infrastructure/preparations/preparation-repository';
import { listPrescriptions } from '@/infrastructure/prescriptions/prescription-repository';
import {
  getGlobalIntakeReminderSettings,
  isIntakeRemindersEnabled,
} from '@/infrastructure/reminders/intake-reminder-repository';
import { getPreparationReminderSettings } from '@/infrastructure/reminders/preparation-reminder-repository';
import { listAllGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  Badge,
  Card,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  colors,
  spacing,
  typography,
} from '@/ui';

const MAX_WATCH_ITEMS = 3;

export default function HomeScreen() {
  const database = useSQLiteContext();
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPreparation, setLastPreparation] =
    useState<PreparationHistoryEntry | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      const now = new Date();
      const today = todayIso();
      const lookaheadEnd = new Date(now);
      lookaheadEnd.setDate(lookaheadEnd.getDate() + NEXT_INTAKE_LOOKAHEAD_DAYS);
      Promise.all([
        listTreatments(database),
        listMedicationBoxes(database),
        getLatestDraftPreparation(database),
        listPreparationHistory(database),
        listPreparationWeeks(database),
        isIntakeRemindersEnabled(database),
        getGlobalIntakeReminderSettings(database),
        getPreparationReminderSettings(database),
        listPendingIntakeCounts(
          database,
          localCivilDate(now),
          localCivilDate(lookaheadEnd),
        ),
        listAllGenericEquivalenceConfirmations(database),
        listPrescriptions(database, today),
      ])
        .then(
          async ([
            treatments,
            boxes,
            draft,
            history,
            weeks,
            remindersEnabled,
            slotTimes,
            preparationReminder,
            pendingIntakeCounts,
            equivalenceConfirmations,
            prescriptions,
          ]) => {
            const asNeededTreatments = treatments.filter(
              (treatment) =>
                treatment.dosageKind === 'AS_NEEDED' &&
                treatment.archivedAt === null,
            );
            const lastIntakes = await Promise.all(
              asNeededTreatments.map((treatment) =>
                getLastAsNeededIntake(database, treatment.id),
              ),
            );
            if (!active) return;

            const equivalences = equivalenceConfirmations.map(
              (confirmation) => ({
                treatmentId: confirmation.treatmentId,
                cis: confirmation.cis,
              }),
            );
            const forecast = buildStockForecast(
              treatments,
              boxes,
              today,
              weeks,
              {
                equivalences,
              },
            );
            const asNeededInputs: AsNeededTreatmentInput[] =
              asNeededTreatments.map((treatment, index) => ({
                treatmentId: treatment.id,
                specialtyName: treatment.specialtyName,
                maxQuantityPerDayHalfUnits:
                  treatment.asNeededInfo.maxQuantityPerDayHalfUnits,
                minIntervalHours: treatment.asNeededInfo.minIntervalHours,
                lastIntake: lastIntakes[index],
              }));

            setItems(
              buildAttentionItems({
                referenceDate: today,
                now,
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
              }),
            );
            setLastPreparation(history[0] ?? null);
            setError(null);
          },
        )
        .catch((reason: unknown) => {
          if (!active) return;
          setError(
            reason instanceof Error
              ? reason.message
              : 'Chargement de votre situation impossible.',
          );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [database]),
  );

  return (
    <HomeContent
      items={items}
      loading={loading}
      error={error}
      lastPreparation={lastPreparation}
    />
  );
}

export function HomeContent({
  items,
  loading,
  error,
  lastPreparation = null,
}: Readonly<{
  items: AttentionItem[] | null;
  loading: boolean;
  error: string | null;
  lastPreparation?: PreparationHistoryEntry | null;
}>) {
  const preparation = items?.find(
    (item): item is Extract<AttentionItem, { type: 'PREPARATION' }> =>
      item.type === 'PREPARATION',
  );
  const nextIntake = items?.filter((item) => item.type === 'NEXT_INTAKE_GROUP');
  const nowItems = [
    ...(preparation ? [preparation] : []),
    ...(nextIntake ?? []),
  ];
  const watchItems =
    items?.filter(
      (item) =>
        item.type === 'STOCK_RENEWAL' ||
        item.type === 'EXPIRATION' ||
        item.type === 'PRESCRIPTION_EXPIRY',
    ) ?? [];
  const visibleWatchItems = watchItems.slice(0, MAX_WATCH_ITEMS);
  const asNeededItems =
    items?.filter((item) => item.type === 'AS_NEEDED_INFO') ?? [];
  const calm =
    items !== null &&
    watchItems.length === 0 &&
    !nowItems.some((item) => isAttentionItemActionRequired(item));
  return (
    <Screen
      fixedHeader={
        <View style={styles.hero}>
          <View style={styles.mark} accessibilityElementsHidden>
            <View style={styles.markTop} />
            <View style={styles.markBottom} />
          </View>
          <View style={styles.heroText}>
            <Text accessibilityRole="header" style={styles.title}>
              PillBox
            </Text>
          </View>
        </View>
      }
    >
      {loading ? <LoadingState label="Chargement de votre situation…" /> : null}
      {error ? (
        <Message tone="error" title="Situation indisponible">
          {error}
        </Message>
      ) : null}
      {!loading && !error && items ? (
        <>
          {calm ? (
            <Message tone="success" title="Tout va bien">
              Aucune action urgente pour l’instant.
            </Message>
          ) : null}
          {nowItems.length > 0 ? (
            <>
              <SectionTitle>Maintenant</SectionTitle>
              {nowItems.map((item) => (
                <AttentionItemCard key={item.id} item={item} />
              ))}
            </>
          ) : null}
          {visibleWatchItems.length > 0 ? (
            <>
              <SectionTitle>À surveiller</SectionTitle>
              {visibleWatchItems.map((item) => (
                <AttentionItemCard compact key={item.id} item={item} />
              ))}
              {watchItems.length > MAX_WATCH_ITEMS ? (
                <Link href="/more" asChild>
                  <Pressable
                    accessibilityLabel="Voir le suivi détaillé"
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.watchMore,
                      pressed && styles.lastPreparationPressed,
                    ]}
                  >
                    <Text style={styles.watchMoreText}>
                      Voir le suivi détaillé
                    </Text>
                  </Pressable>
                </Link>
              ) : null}
            </>
          ) : null}
          {asNeededItems.length > 0 ? (
            <>
              <SectionTitle>Si besoin</SectionTitle>
              {asNeededItems.map((item) => (
                <AttentionItemCard compact key={item.id} item={item} />
              ))}
            </>
          ) : null}
        </>
      ) : null}
      {!loading && !error && lastPreparation ? (
        <>
          <SectionTitle>Activité récente</SectionTitle>
          <LastPreparationCard
            detail={`Validée le ${formatDateTime(lastPreparation.completedAt)} · semaine du ${formatDate(lastPreparation.startDate)}`}
          />
        </>
      ) : null}
    </Screen>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function LastPreparationCard({ detail }: { detail: string }) {
  return (
    <Link href="/preparations/history" asChild>
      <Pressable
        accessibilityLabel={`Dernière préparation : ${detail}`}
        accessibilityRole="button"
        style={({ pressed }) => pressed && styles.lastPreparationPressed}
      >
        <Card style={styles.lastPreparationCard}>
          <View style={styles.lastPreparationRow}>
            <View style={styles.homeLinkText}>
              <Badge label="Historique" tone="neutral" />
              <Text style={styles.homeLinkTitle}>Dernière préparation</Text>
              <Text style={typography.caption}>{detail}</Text>
            </View>
            <Text
              accessibilityElementsHidden
              maxFontSizeMultiplier={1.2}
              style={styles.chevron}
            >
              ›
            </Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  chevron: {
    color: colors.brand,
    flexShrink: 0,
    fontSize: 30,
    marginLeft: spacing.md,
  },
  hero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  heroText: { flex: 1 },
  homeLinkText: { flex: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  homeLinkTitle: typography.label,
  lastPreparationCard: {
    borderColor: colors.borderStrong,
    minHeight: 112,
    width: '100%',
  },
  lastPreparationPressed: { opacity: 0.72 },
  lastPreparationRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  mark: { height: 48, width: 30 },
  markTop: {
    backgroundColor: colors.accent,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    height: 24,
  },
  markBottom: {
    backgroundColor: colors.brand,
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
    height: 24,
  },
  title: typography.display,
  watchMore: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  watchMoreText: { color: colors.brand, fontWeight: '700' },
});
