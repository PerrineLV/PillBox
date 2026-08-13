import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  civilDateToPickerDate,
  formatFrenchCivilPeriod,
} from '@/components/treatments/civil-date';
import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';
import {
  groupAsNeededIntakesByPeriod,
  groupIntakesByPeriod,
  recordedTakenRatio,
  type AsNeededPeriodStatistics,
  type IntakePeriodStatistics,
  type StatisticsGrouping,
} from '@/domain/intakes/intake-statistics';
import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import { localCivilDate } from '@/domain/reminders/intake-reminder';
import type { Treatment } from '@/domain/treatments/treatment';
import { listAsNeededIntakesInRange } from '@/infrastructure/intakes/as-needed-intake-repository';
import { listIntakeHistory } from '@/infrastructure/intakes/intake-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  Card,
  EmptyState,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  colors,
  radii,
  sizes,
  spacing,
  typography,
} from '@/ui';

type Period = 7 | 30 | 90 | 'all';

export default function IntakeStatisticsScreen() {
  const database = useSQLiteContext();
  const [scheduled, setScheduled] = useState<IntakeRecord[] | null>(null);
  const [asNeeded, setAsNeeded] = useState<AsNeededIntakeRecord[] | null>(null);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [grouping, setGrouping] = useState<StatisticsGrouping>('week');
  const [period, setPeriod] = useState<Period>(90);
  const [treatmentId, setTreatmentId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const endDate = localCivilDate(new Date());
      const startDate = period === 'all' ? null : dateDaysAgo(period - 1);
      const [scheduledRecords, asNeededRecords, loadedTreatments] =
        await Promise.all([
          listIntakeHistory(database, { startDate, endDate, treatmentId }),
          listAsNeededIntakesInRange(database, {
            startAt: startDate === null ? null : `${startDate}T00:00:00.000Z`,
            endAt: `${endDate}T23:59:59.999Z`,
            treatmentId,
          }),
          listTreatments(database),
        ]);
      setScheduled(scheduledRecords);
      setAsNeeded(asNeededRecords);
      setTreatments(loadedTreatments);
      setError(null);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Statistiques indisponibles.',
      );
    }
  }, [database, period, treatmentId]);
  useEffect(() => {
    void load();
  }, [load]);

  const scheduledPeriods =
    scheduled === null ? null : groupIntakesByPeriod(scheduled, grouping);
  const asNeededPeriods =
    asNeeded === null ? null : groupAsNeededIntakesByPeriod(asNeeded, grouping);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Statistiques' }} />
      <Text style={typography.title}>Statistiques</Text>
      <Message>
        Ce résumé compte uniquement les statuts réellement enregistrés. Une
        prise non renseignée n’est jamais comptée comme prise ni comme ignorée,
        et aucun score d’observance n’est calculé.
      </Message>
      <SectionTitle>Regroupement</SectionTitle>
      <View style={styles.chips}>
        <FilterChip
          label="Par semaine"
          selected={grouping === 'week'}
          onPress={() => setGrouping('week')}
        />
        <FilterChip
          label="Par mois"
          selected={grouping === 'month'}
          onPress={() => setGrouping('month')}
        />
      </View>
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

      <SectionTitle>Prises planifiées</SectionTitle>
      {scheduledPeriods === null && !error ? (
        <LoadingState label="Chargement des statistiques…" />
      ) : null}
      {scheduledPeriods !== null && scheduledPeriods.length === 0 ? (
        <EmptyState
          title="Aucune prise planifiée dans cette période"
          description="Les traitements « si besoin » sont comptés séparément ci-dessous."
        />
      ) : null}
      {scheduledPeriods?.map((stats) => (
        <ScheduledPeriodCard
          key={stats.periodKey}
          grouping={grouping}
          stats={stats}
        />
      ))}

      <SectionTitle>Traitements si besoin</SectionTitle>
      <Message tone="info">
        Sans calendrier attendu, ces prises n’entrent dans aucun taux basé sur
        des prises prévues : voici uniquement le nombre de prises enregistrées.
      </Message>
      {asNeededPeriods !== null && asNeededPeriods.length === 0 ? (
        <EmptyState title="Aucune prise « si besoin » enregistrée dans cette période" />
      ) : null}
      {asNeededPeriods?.map((stats) => (
        <AsNeededPeriodCard
          key={stats.periodKey}
          grouping={grouping}
          stats={stats}
        />
      ))}
    </Screen>
  );
}

function ScheduledPeriodCard({
  stats,
  grouping,
}: {
  stats: IntakePeriodStatistics;
  grouping: StatisticsGrouping;
}) {
  const ratio = recordedTakenRatio(stats);
  return (
    <Card>
      <Text style={typography.label}>{periodLabel(stats, grouping)}</Text>
      <View accessibilityElementsHidden style={styles.bar}>
        <View
          style={[
            styles.barSegment,
            { flex: stats.takenCount, backgroundColor: colors.success },
          ]}
        />
        <View
          style={[
            styles.barSegment,
            { flex: stats.skippedCount, backgroundColor: colors.warning },
          ]}
        />
        <View
          style={[
            styles.barSegment,
            { flex: stats.unsetCount, backgroundColor: colors.border },
          ]}
        />
      </View>
      <Text style={typography.body}>
        {stats.scheduledCount} prise(s) prévue(s) · {stats.takenCount} prise(s)
        · {stats.skippedCount} ignorée(s) · {stats.unsetCount} non renseignée(s)
      </Text>
      {ratio !== null ? (
        <Text style={typography.caption}>
          Proportion de prises enregistrées comme prises : {formatRatio(ratio)}{' '}
          ({stats.takenCount} sur {stats.scheduledCount} prises prévues)
        </Text>
      ) : null}
    </Card>
  );
}

function AsNeededPeriodCard({
  stats,
  grouping,
}: {
  stats: AsNeededPeriodStatistics;
  grouping: StatisticsGrouping;
}) {
  return (
    <Card tone="muted">
      <Text style={typography.label}>{periodLabel(stats, grouping)}</Text>
      <Text style={typography.body}>
        {stats.recordedCount} prise(s) enregistrée(s)
      </Text>
    </Card>
  );
}

function periodLabel(
  period: { periodKey: string; startDate: string; endDate: string },
  grouping: StatisticsGrouping,
): string {
  if (grouping === 'week')
    return `Semaine ${formatFrenchCivilPeriod(period.startDate, period.endDate)}`;
  const date = civilDateToPickerDate(period.startDate);
  if (date === null) return period.periodKey;
  const label = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
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
    minHeight: sizes.touch,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: typography.caption,
  chipTextSelected: { color: colors.surface, fontWeight: '700' },
  bar: {
    borderRadius: radii.sm,
    flexDirection: 'row',
    height: 10,
    overflow: 'hidden',
  },
  barSegment: { minWidth: 0 },
});
