import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OutsidePillboxIntakeBoxChoice } from '@/components/intakes/outside-pillbox-intake-box-choice';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import type {
  IntakeRecord,
  IntakeStatus,
} from '@/domain/intakes/intake-tracking';
import { localCivilDate } from '@/domain/reminders/intake-reminder';
import { formatHalfUnits, type Treatment } from '@/domain/treatments/treatment';
import {
  listIntakeHistory,
  listIntakePostponements,
  updateIntakeStatus,
} from '@/infrastructure/intakes/intake-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppCard,
  AppScreen,
  Banner,
  EmptyState,
  FilterPills,
  INTAKE_SLOT_LABELS,
  LoadingState,
  Message,
  Section,
  SeverityBadge,
  StackHeader,
  colors,
  typography,
  type SeverityLevel,
} from '@/ui';

type Period = '7' | '30' | '90' | 'all';

const PERIODS: readonly { value: Period; label: string }[] = [
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: 'all', label: 'Tout' },
];
const STATUS_LABELS: Record<IntakeStatus, string> = {
  UNSET: 'Non renseigné',
  TAKEN: 'Pris',
  SKIPPED: 'Ignoré',
};
const STATUS_LEVELS: Record<IntakeStatus, SeverityLevel> = {
  UNSET: 'neutral',
  TAKEN: 'ok',
  SKIPPED: 'warning',
};
const CORRECTIONS: readonly IntakeStatus[] = ['TAKEN', 'SKIPPED', 'UNSET'];

export default function IntakeHistoryScreen() {
  const database = useSQLiteContext();
  const [records, setRecords] = useState<IntakeRecord[] | null>(null);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [period, setPeriod] = useState<Period>('30');
  const [treatmentId, setTreatmentId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});
  const [outsidePillboxRecord, setOutsidePillboxRecord] =
    useState<IntakeRecord | null>(null);

  const load = useCallback(async () => {
    try {
      const endDate = localCivilDate(new Date());
      const startDate =
        period === 'all' ? null : dateDaysAgo(Number(period) - 1);
      const [history, loadedTreatments, loadedReports] = await Promise.all([
        listIntakeHistory(database, { startDate, endDate, treatmentId }),
        listTreatments(database),
        listIntakePostponements(database),
      ]);
      setRecords(history);
      setTreatments(loadedTreatments);
      setReports(
        Object.fromEntries(
          loadedReports.map((item) => [
            `${item.date}:${item.slot}`,
            item.scheduledAt,
          ]),
        ),
      );
      setError(null);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Historique indisponible.',
      );
    }
  }, [database, period, treatmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(
    record: IntakeRecord,
    status: IntakeStatus,
  ): Promise<void> {
    if (status === 'TAKEN' && isOutsidePillbox(record)) {
      setOutsidePillboxRecord(record);
      return;
    }
    setBusyKey(record.key);
    try {
      await updateIntakeStatus(database, record.key, status);
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Correction impossible.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  function isOutsidePillbox(record: IntakeRecord): boolean {
    const treatment = treatments.find((item) => item.id === record.treatmentId);
    return (
      treatment?.dosageKind === 'SCHEDULED' && !treatment.includedInPillbox
    );
  }

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle="Ni preuve de prise, ni score d’observance"
          title="Historique des prises"
        />
      }
    >
      <FilterPills
        accessibilityLabel="Période affichée"
        onChange={(next) => setPeriod(next)}
        options={PERIODS}
        value={period}
      />
      {treatments.length > 0 ? (
        <Section label="Traitement">
          <ScrollView
            contentContainerStyle={styles.treatmentFilters}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <TreatmentChip
              label="Tous"
              onPress={() => setTreatmentId(null)}
              selected={treatmentId === null}
            />
            {treatments.map((treatment) => (
              <TreatmentChip
                key={treatment.id}
                label={treatment.specialtyName}
                onPress={() => setTreatmentId(treatment.id)}
                selected={treatmentId === treatment.id}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {error ? <Message tone="error">{error}</Message> : null}
      {records === null && !error ? (
        <LoadingState label="Chargement de l’historique…" />
      ) : null}
      {records?.length === 0 ? (
        <EmptyState
          description="Les prises apparaissent lorsque leurs rappels sont planifiés localement."
          title="Aucune prise dans cette période"
        />
      ) : null}

      {records?.map((record) => {
        const report = reports[`${record.date}:${record.slot}`];
        return (
          <AppCard key={record.key}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{record.specialtyName}</Text>
              <SeverityBadge
                label={STATUS_LABELS[record.status]}
                level={STATUS_LEVELS[record.status]}
              />
            </View>
            <Text style={typography.detail}>
              {formatLongFrenchCivilDate(record.date)} ·{' '}
              {INTAKE_SLOT_LABELS[record.slot]} ·{' '}
              {formatHalfUnits(record.quantityHalfUnits)} unité(s)
              {record.pharmaceuticalForm
                ? ` · ${record.pharmaceuticalForm}`
                : ''}
            </Text>
            {report ? (
              <Text style={styles.report}>
                Reporté au {formatFrenchDateTime(report)}
              </Text>
            ) : null}
            <View style={styles.corrections}>
              {CORRECTIONS.map((status) => {
                const current = record.status === status;
                return (
                  <Pressable
                    accessibilityLabel={`Marquer ${record.specialtyName} comme ${STATUS_LABELS[status].toLowerCase()}`}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: current,
                      disabled: busyKey !== null,
                    }}
                    disabled={busyKey !== null}
                    key={status}
                    onPress={() => void changeStatus(record, status)}
                    style={({ pressed }) => [
                      styles.correction,
                      current
                        ? styles.correctionCurrent
                        : styles.correctionIdle,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.correctionText,
                        current && styles.correctionTextCurrent,
                      ]}
                    >
                      {STATUS_LABELS[status]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </AppCard>
        );
      })}

      <Banner level="neutral">
        La correction n’est jamais bloquée : les trois statuts restent
        réassignables à tout moment.
      </Banner>

      <OutsidePillboxIntakeBoxChoice
        database={database}
        onCancel={() => setOutsidePillboxRecord(null)}
        onTaken={async () => {
          setOutsidePillboxRecord(null);
          await load();
        }}
        record={outsidePillboxRecord}
      />
    </AppScreen>
  );
}

function TreatmentChip({
  label,
  selected,
  onPress,
}: Readonly<{ label: string; selected: boolean; onPress(): void }>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : styles.chipIdle,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[styles.chipText, selected ? styles.chipTextSelected : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localCivilDate(date);
}

const styles = StyleSheet.create({
  treatmentFilters: { flexDirection: 'row', gap: 7, paddingRight: 20 },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  chipSelected: {
    backgroundColor: colors.headerDark,
    borderColor: colors.headerDark,
  },
  chipIdle: { backgroundColor: colors.surface, borderColor: colors.cardBorder },
  chipText: { color: colors.textMuted, fontSize: 12.5, fontWeight: '600' },
  chipTextSelected: { color: colors.onDark, fontWeight: '700' },
  cardHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  name: { ...typography.itemTitle, flex: 1, fontSize: 15, minWidth: 0 },
  report: {
    color: colors.warning,
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 15,
  },
  corrections: { flexDirection: 'row', gap: 7 },
  correction: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    height: 36,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
  },
  correctionCurrent: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  correctionIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
  },
  correctionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
  },
  correctionTextCurrent: { color: colors.onDark, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
