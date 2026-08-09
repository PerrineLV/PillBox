import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type {
  IntakeRecord,
  IntakeStatus,
} from '@/domain/intakes/intake-tracking';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import { localCivilDate } from '@/domain/reminders/intake-reminder';
import {
  formatHalfUnits,
  type IntakeSlot,
  type Treatment,
} from '@/domain/treatments/treatment';
import {
  listIntakeHistory,
  listIntakePostponements,
  updateIntakeStatus,
} from '@/infrastructure/intakes/intake-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppButton,
  Badge,
  Card,
  EmptyState,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

type Period = 7 | 30 | 90 | 'all';
const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};
const STATUS_LABELS: Record<IntakeStatus, string> = {
  UNSET: 'Non renseigné',
  TAKEN: 'Pris',
  SKIPPED: 'Ignoré',
};

export default function IntakeHistoryScreen() {
  const database = useSQLiteContext();
  const [records, setRecords] = useState<IntakeRecord[] | null>(null);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [period, setPeriod] = useState<Period>(30);
  const [treatmentId, setTreatmentId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const endDate = localCivilDate(new Date());
      const startDate = period === 'all' ? null : dateDaysAgo(period - 1);
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

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, title: 'Historique des prises' }}
      />
      <Text style={typography.title}>Historique des prises</Text>
      <Message>
        Ce journal personnel n’est ni une preuve de prise ni un score
        d’observance.
      </Message>
      <SectionTitle>Période</SectionTitle>
      <View style={styles.chips}>
        {([7, 30, 90, 'all'] as const).map((value) => (
          <FilterChip
            key={String(value)}
            label={value === 'all' ? 'Tout' : `${value} jours`}
            selected={period === value}
            onPress={() => setPeriod(value)}
          />
        ))}
      </View>
      <SectionTitle>Traitement</SectionTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <FilterChip
          label="Tous"
          selected={treatmentId === null}
          onPress={() => setTreatmentId(null)}
        />
        {treatments.map((treatment) => (
          <FilterChip
            key={treatment.id}
            label={treatment.specialtyName}
            selected={treatmentId === treatment.id}
            onPress={() => setTreatmentId(treatment.id)}
          />
        ))}
      </ScrollView>
      {error ? <Message tone="error">{error}</Message> : null}
      {records === null && !error ? (
        <LoadingState label="Chargement de l’historique…" />
      ) : null}
      {records?.length === 0 ? (
        <EmptyState
          title="Aucune prise dans cette période"
          description="Les prises apparaissent lorsque leurs rappels sont planifiés localement."
        />
      ) : null}
      {records?.map((record) => (
        <Card key={record.key}>
          <Text style={typography.label}>{record.specialtyName}</Text>
          <Text style={typography.caption}>
            {formatLongFrenchCivilDate(record.date)} ·{' '}
            {SLOT_LABELS[record.slot]}
          </Text>
          <Text style={typography.body}>
            {formatHalfUnits(record.quantityHalfUnits)} unité(s)
            {record.pharmaceuticalForm ? ` · ${record.pharmaceuticalForm}` : ''}
          </Text>
          <Badge
            label={STATUS_LABELS[record.status]}
            tone={
              record.status === 'TAKEN'
                ? 'success'
                : record.status === 'SKIPPED'
                  ? 'warning'
                  : 'neutral'
            }
          />
          {reports[`${record.date}:${record.slot}`] ? (
            <Text style={typography.caption}>
              Reporté au{' '}
              {formatFrenchDateTime(reports[`${record.date}:${record.slot}`])}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <AppButton
              label="Pris"
              variant={record.status === 'TAKEN' ? 'primary' : 'secondary'}
              disabled={busyKey !== null}
              onPress={() => void changeStatus(record, 'TAKEN')}
            />
            <AppButton
              label="Ignoré"
              variant="secondary"
              disabled={busyKey !== null}
              onPress={() => void changeStatus(record, 'SKIPPED')}
            />
            <AppButton
              label="Non renseigné"
              variant="quiet"
              disabled={busyKey !== null}
              onPress={() => void changeStatus(record, 'UNSET')}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: typography.caption,
  chipTextSelected: { color: colors.surface, fontWeight: '700' },
  actions: { gap: spacing.sm },
});
