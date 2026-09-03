import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
  pickerDateToCivilDate,
} from '@/components/treatments/civil-date';
import type {
  TimelineEvent,
  TimelineEventType,
} from '@/domain/history/timeline';
import {
  formatHalfUnits,
  type PhaseFrequency,
  type Treatment,
} from '@/domain/treatments/treatment';
import { listTimelineEvents } from '@/infrastructure/history/timeline-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppScreen,
  EmptyState,
  FilterPills,
  INTAKE_SLOT_LABELS,
  LoadingState,
  Message,
  STOCK_MOVEMENT_TYPE_LABELS,
  Section,
  SeverityBadge,
  StackHeader,
  WEEKDAY_LABELS,
  colors,
  radii,
  severity as severityScale,
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

type EventGroup = Readonly<{
  key: string;
  label: string;
  types: readonly TimelineEventType[];
}>;

const EVENT_GROUPS: readonly EventGroup[] = [
  {
    key: 'treatment',
    label: 'Traitement',
    types: [
      'TREATMENT_CREATED',
      'DOSAGE_MODIFIED',
      'PHASE_STARTED',
      'DOSAGE_INTERRUPTED',
      'TREATMENT_ARCHIVED',
      'TREATMENT_REACTIVATED',
    ],
  },
  {
    key: 'preparation',
    label: 'Préparations',
    types: ['PREPARATION_COMPLETED', 'BOX_USED'],
  },
  { key: 'stock', label: 'Stock', types: ['STOCK_MOVEMENT'] },
  { key: 'intake', label: 'Prises', types: ['INTAKE_RECORDED'] },
];

export default function TimelineScreen() {
  const { treatmentId: treatmentIdParam } = useLocalSearchParams<{
    treatmentId?: string;
  }>();
  const database = useSQLiteContext();
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [period, setPeriod] = useState<Period>('90');
  const [treatmentId, setTreatmentId] = useState<number | null>(
    treatmentIdParam ? Number(treatmentIdParam) : null,
  );
  const [selectedGroups, setSelectedGroups] = useState<readonly string[]>(
    EVENT_GROUPS.map((group) => group.key),
  );
  const [error, setError] = useState<string | null>(null);

  const startDate = period === 'all' ? null : dateDaysAgo(Number(period) - 1);

  const load = useCallback(async () => {
    try {
      const [loadedEvents, loadedTreatments] = await Promise.all([
        listTimelineEvents(database, { treatmentId, startDate }),
        listTreatments(database),
      ]);
      setEvents(loadedEvents);
      setTreatments(loadedTreatments);
      setError(null);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Chronologie indisponible.',
      );
    }
  }, [database, treatmentId, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleGroup(key: string): void {
    setSelectedGroups((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  const allowedTypes = EVENT_GROUPS.filter((group) =>
    selectedGroups.includes(group.key),
  ).flatMap((group) => group.types);
  const filtered = (events ?? [])
    .filter((event) => allowedTypes.includes(event.type))
    .slice()
    .reverse();

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle="Vue de consultation : rien n’y est modifiable"
          title="Chronologie"
        />
      }
    >
      <FilterPills
        accessibilityLabel="Période affichée"
        onChange={(next) => setPeriod(next)}
        options={PERIODS}
        value={period}
      />
      <Section label="Type d’événement">
        <View style={styles.groupFilters}>
          {EVENT_GROUPS.map((group) => (
            <Chip
              key={group.key}
              label={group.label}
              onPress={() => toggleGroup(group.key)}
              selected={selectedGroups.includes(group.key)}
            />
          ))}
        </View>
      </Section>
      {treatments.length > 0 ? (
        <Section label="Traitement">
          <ScrollView
            contentContainerStyle={styles.treatmentFilters}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <Chip
              label="Tous"
              onPress={() => setTreatmentId(null)}
              selected={treatmentId === null}
            />
            {treatments.map((treatment) => (
              <Chip
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
      {events === null && !error ? (
        <LoadingState label="Chargement de la chronologie…" />
      ) : null}
      {events !== null && filtered.length === 0 ? (
        <EmptyState
          description="Élargissez la période ou les types d’événement."
          title="Aucun événement dans cette sélection"
        />
      ) : null}

      {filtered.length > 0 ? (
        <View style={styles.thread}>
          <View accessibilityElementsHidden style={styles.rail} />
          {filtered.map((event) => (
            <TimelineEntry event={event} key={event.id} />
          ))}
        </View>
      ) : null}
    </AppScreen>
  );
}

function TimelineEntry({ event }: Readonly<{ event: TimelineEvent }>) {
  const { title, detail, level } = describeEvent(event);
  return (
    <View style={styles.entry}>
      <View
        accessibilityElementsHidden
        style={[styles.dot, { backgroundColor: severityScale[level].text }]}
      />
      <View style={styles.entryBody}>
        <Text style={styles.occurredAt}>
          {formatEventDate(event.occurredAt)}
        </Text>
        <View style={styles.entryCard}>
          <View style={styles.entryHead}>
            <Text style={styles.entryName}>{event.specialtyName}</Text>
            <SeverityBadge label={title} level={level} />
          </View>
          {detail ? <Text style={styles.entryDetail}>{detail}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function describeEvent(event: TimelineEvent): {
  title: string;
  detail: string | null;
  level: SeverityLevel;
} {
  switch (event.type) {
    case 'TREATMENT_CREATED':
      return { title: 'Traitement créé', detail: null, level: 'neutral' };
    case 'DOSAGE_MODIFIED':
      return { title: 'Posologie modifiée', detail: null, level: 'neutral' };
    case 'PHASE_STARTED':
      return {
        title: 'Nouvelle posologie en vigueur',
        detail: describeFrequency(event.frequency),
        level: 'neutral',
      };
    case 'DOSAGE_INTERRUPTED':
      return { title: 'Posologie interrompue', detail: null, level: 'warning' };
    case 'TREATMENT_ARCHIVED':
      return { title: 'Traitement archivé', detail: null, level: 'warning' };
    case 'TREATMENT_REACTIVATED':
      return { title: 'Traitement réactivé', detail: null, level: 'ok' };
    case 'PREPARATION_COMPLETED':
      return {
        title: 'Préparation validée',
        detail: `Semaine du ${formatLongFrenchCivilDate(event.startDate)} au ${formatLongFrenchCivilDate(event.endDate)}`,
        level: 'ok',
      };
    case 'BOX_USED':
      return {
        title: `Boîte utilisée · lot ${event.lot ?? 'non renseigné'}`,
        detail:
          `${event.presentationLabel} · ${formatHalfUnits(event.quantityHalfUnits)} unité(s) · péremption ${formatLongFrenchCivilDate(event.expirationDate)}` +
          (event.matchedSpecialtyName
            ? ` · équivalence générique confirmée : ${event.matchedSpecialtyName}`
            : ''),
        level: 'ok',
      };
    case 'STOCK_MOVEMENT':
      return {
        title: STOCK_MOVEMENT_TYPE_LABELS[event.movementType],
        detail:
          `${event.quantityDelta > 0 ? '+' : ''}${event.quantityDelta} · ${event.explanation}` +
          ` · lot ${event.lot ?? 'non renseigné'} · péremption ${formatLongFrenchCivilDate(event.expirationDate)}`,
        level: 'neutral',
      };
    case 'INTAKE_RECORDED':
      return {
        title: `Prise du ${INTAKE_SLOT_LABELS[event.slot].toLowerCase()} ${event.status === 'TAKEN' ? 'prise' : 'ignorée'}`,
        detail: `${formatHalfUnits(event.quantityHalfUnits)} unité(s) le ${formatLongFrenchCivilDate(event.date)}`,
        level: event.status === 'TAKEN' ? 'ok' : 'warning',
      };
  }
}

function describeFrequency(frequency: PhaseFrequency): string {
  if (frequency.type === 'daily') return 'Tous les jours';
  if (frequency.type === 'interval')
    return `Tous les ${frequency.everyNDays} jours (ancrage le ${formatLongFrenchCivilDate(frequency.anchorDate)})`;
  if (frequency.weekday === null) return 'Une fois par semaine';
  return `Chaque ${WEEKDAY_LABELS[frequency.weekday].toLowerCase()}`;
}

function formatEventDate(occurredAt: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(occurredAt)
    ? formatLongFrenchCivilDate(occurredAt)
    : formatFrenchDateTime(occurredAt);
}

function Chip({
  label,
  selected,
  onPress,
}: Readonly<{ label: string; selected: boolean; onPress(): void }>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
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
  return pickerDateToCivilDate(date);
}

const styles = StyleSheet.create({
  groupFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  treatmentFilters: { flexDirection: 'row', gap: 7, paddingRight: 20 },
  chip: {
    alignItems: 'center',
    borderRadius: radii.pill,
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
  thread: { gap: 14, position: 'relative' },
  rail: {
    backgroundColor: colors.cardBorder,
    bottom: 8,
    left: 4,
    position: 'absolute',
    top: 8,
    width: 2,
  },
  entry: { flexDirection: 'row', gap: 12 },
  dot: {
    borderColor: colors.background,
    borderRadius: radii.pill,
    borderWidth: 2,
    height: 10,
    marginTop: 3,
    width: 10,
  },
  entryBody: { flex: 1, gap: 5, minWidth: 0 },
  occurredAt: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 13,
  },
  entryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: 15,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  entryHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  entryName: {
    ...typography.itemTitle,
    flex: 1,
    fontSize: 13.5,
    lineHeight: 17,
    minWidth: 0,
  },
  entryDetail: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
  pressed: { opacity: 0.72 },
});
