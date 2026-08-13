import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AttentionItemCard } from '@/components/home/attention-item-card';
import { UpdateNoticeCard } from '@/components/updates/update-notice-card';
import { useUpdateNotice } from '@/components/updates/use-update-notice';
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
import type { UpdateNotice } from '@/domain/updates/update-notice';
import { getLastAsNeededIntake } from '@/infrastructure/intakes/as-needed-intake-repository';
import { listPendingIntakeCounts } from '@/infrastructure/intakes/intake-repository';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  getLatestDraftPreparation,
  listPreparationHistory,
  listPreparationWeeks,
  type PreparationHistoryEntry,
} from '@/infrastructure/preparations/preparation-repository';
import {
  getGlobalIntakeReminderSettings,
  isIntakeRemindersEnabled,
} from '@/infrastructure/reminders/intake-reminder-repository';
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

export default function HomeScreen() {
  const database = useSQLiteContext();
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPreparation, setLastPreparation] =
    useState<PreparationHistoryEntry | null>(null);
  const update = useUpdateNotice();

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
        listPendingIntakeCounts(
          database,
          localCivilDate(now),
          localCivilDate(lookaheadEnd),
        ),
        listAllGenericEquivalenceConfirmations(database),
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
            pendingIntakeCounts,
            equivalenceConfirmations,
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
      updateNotice={update.notice}
      onDownloadUpdate={update.download}
      onPostponeUpdate={update.postpone}
    />
  );
}

export function HomeContent({
  items,
  loading,
  error,
  lastPreparation = null,
  updateNotice = null,
  onDownloadUpdate,
  onPostponeUpdate,
}: Readonly<{
  items: AttentionItem[] | null;
  loading: boolean;
  error: string | null;
  lastPreparation?: PreparationHistoryEntry | null;
  updateNotice?: UpdateNotice | null;
  onDownloadUpdate?: () => void;
  onPostponeUpdate?: () => void;
}>) {
  const calm =
    items !== null &&
    !items.some((item) => isAttentionItemActionRequired(item));
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
            <Text style={styles.subtitle}>
              Votre pilulier, simplement et sûrement.
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
            <Message tone="success" title="Tout est en ordre">
              Aucune action urgente pour l’instant.
            </Message>
          ) : null}
          <SectionTitle>À faire</SectionTitle>
          {items.map((item) => (
            <AttentionItemCard key={item.id} item={item} />
          ))}
        </>
      ) : null}
      {lastPreparation ? (
        <LastPreparationCard
          detail={`Validée le ${formatDateTime(lastPreparation.completedAt)} · semaine du ${formatDate(lastPreparation.startDate)}`}
        />
      ) : null}
      {updateNotice !== null &&
      onDownloadUpdate !== undefined &&
      onPostponeUpdate !== undefined ? (
        <UpdateNoticeCard
          notice={updateNotice}
          onDownload={onDownloadUpdate}
          onPostpone={onPostponeUpdate}
        />
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
              <Text style={styles.subtitle}>{detail}</Text>
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
  subtitle: typography.caption,
  title: typography.display,
});
