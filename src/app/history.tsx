import { Stack, useLocalSearchParams } from 'expo-router';
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
  Badge,
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
import {
  INTAKE_SLOT_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  WEEKDAY_LABELS,
} from '@/ui/labels';

type Period = 7 | 30 | 90 | 'all';
type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

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
  const [period, setPeriod] = useState<Period>(90);
  const [treatmentId, setTreatmentId] = useState<number | null>(
    treatmentIdParam ? Number(treatmentIdParam) : null,
  );
  const [selectedGroups, setSelectedGroups] = useState<readonly string[]>(
    EVENT_GROUPS.map((group) => group.key),
  );
  const [error, setError] = useState<string | null>(null);

  const startDate = period === 'all' ? null : dateDaysAgo(period - 1);

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
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Chronologie' }} />
      <Text style={typography.title}>Chronologie</Text>
      <Message>
        Vue de consultation, construite à partir de l’historique déjà enregistré
        : elle ne modifie ni les posologies ni les préparations passées.
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
      <SectionTitle>Type d’événement</SectionTitle>
      <View style={styles.chips}>
        {EVENT_GROUPS.map((group) => (
          <FilterChip
            key={group.key}
            label={group.label}
            selected={selectedGroups.includes(group.key)}
            onPress={() => toggleGroup(group.key)}
          />
        ))}
      </View>
      {error ? <Message tone="error">{error}</Message> : null}
      {events === null && !error ? (
        <LoadingState label="Chargement de la chronologie…" />
      ) : null}
      {events !== null && filtered.length === 0 ? (
        <EmptyState
          title="Aucun événement dans cette sélection"
          description="Élargissez la période ou les types d’événement."
        />
      ) : null}
      {filtered.map((event) => (
        <TimelineEventCard key={event.id} event={event} />
      ))}
    </Screen>
  );
}

function TimelineEventCard({ event }: { event: TimelineEvent }) {
  const { title, detail, tone } = describeEvent(event);
  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={typography.label}>{event.specialtyName}</Text>
        <Badge label={title} tone={tone} />
      </View>
      <Text style={typography.caption}>
        {formatEventDate(event.occurredAt)}
      </Text>
      {detail ? <Text style={typography.body}>{detail}</Text> : null}
    </Card>
  );
}

function describeEvent(event: TimelineEvent): {
  title: string;
  detail: string | null;
  tone: BadgeTone;
} {
  switch (event.type) {
    case 'TREATMENT_CREATED':
      return { title: 'Traitement créé', detail: null, tone: 'neutral' };
    case 'DOSAGE_MODIFIED':
      return { title: 'Posologie modifiée', detail: null, tone: 'neutral' };
    case 'PHASE_STARTED':
      return {
        title: 'Nouvelle posologie en vigueur',
        detail: describeFrequency(event.frequency),
        tone: 'neutral',
      };
    case 'DOSAGE_INTERRUPTED':
      return {
        title: 'Posologie interrompue',
        detail: null,
        tone: 'warning',
      };
    case 'TREATMENT_ARCHIVED':
      return { title: 'Traitement archivé', detail: null, tone: 'warning' };
    case 'TREATMENT_REACTIVATED':
      return { title: 'Traitement réactivé', detail: null, tone: 'success' };
    case 'PREPARATION_COMPLETED':
      return {
        title: 'Préparation validée',
        detail: `Semaine du ${formatLongFrenchCivilDate(event.startDate)} au ${formatLongFrenchCivilDate(event.endDate)}`,
        tone: 'success',
      };
    case 'BOX_USED':
      return {
        title: `Boîte utilisée · lot ${event.lot ?? 'non renseigné'}`,
        detail:
          `${event.presentationLabel} · ${formatHalfUnits(event.quantityHalfUnits)} unité(s) · péremption ${formatLongFrenchCivilDate(event.expirationDate)}` +
          (event.matchedSpecialtyName
            ? ` · équivalence générique confirmée : ${event.matchedSpecialtyName}`
            : ''),
        tone: 'success',
      };
    case 'STOCK_MOVEMENT':
      return {
        title: STOCK_MOVEMENT_TYPE_LABELS[event.movementType],
        detail:
          `${event.quantityDelta > 0 ? '+' : ''}${event.quantityDelta} · ${event.explanation}` +
          ` · lot ${event.lot ?? 'non renseigné'} · péremption ${formatLongFrenchCivilDate(event.expirationDate)}`,
        tone: 'neutral',
      };
    case 'INTAKE_RECORDED':
      return {
        title: `Prise du ${INTAKE_SLOT_LABELS[event.slot].toLowerCase()} ${event.status === 'TAKEN' ? 'prise' : 'ignorée'}`,
        detail: `${formatHalfUnits(event.quantityHalfUnits)} unité(s) le ${formatLongFrenchCivilDate(event.date)}`,
        tone: event.status === 'TAKEN' ? 'success' : 'warning',
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
  return pickerDateToCivilDate(date);
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
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
});
