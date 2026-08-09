import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatHalfUnits, type Treatment } from '@/domain/treatments/treatment';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  Badge,
  EmptyState,
  LoadingState,
  Message,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

export default function TreatmentsScreen() {
  const database = useSQLiteContext();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('fr-FR');
  const visibleTreatments = treatments.filter((item) =>
    item.specialtyName.toLocaleLowerCase('fr-FR').includes(normalizedQuery),
  );
  const activeTreatments = visibleTreatments.filter(
    (item) => item.archivedAt === null,
  );
  const archivedTreatments = visibleTreatments.filter(
    (item) => item.archivedAt !== null,
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listTreatments(database)
        .then((items) => {
          if (active) {
            setTreatments(items);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : 'Chargement impossible.',
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
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={typography.title}>
            Traitements
          </Text>
          <Text style={typography.caption}>
            {activeTreatments.length} actif
            {activeTreatments.length > 1 ? 's' : ''}
          </Text>
        </View>
        <Link href="/medications/search" style={styles.add}>
          Ajouter
        </Link>
      </View>
      <TextInput
        accessibilityLabel="Rechercher dans mes traitements"
        onChangeText={setQuery}
        placeholder="Rechercher un traitement"
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        value={query}
      />
      {notice ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {loading ? <LoadingState label="Chargement des traitements…" /> : null}
      {error ? (
        <Message tone="error" title="Traitements indisponibles">
          {error}
        </Message>
      ) : null}
      <FlatList
        data={activeTreatments}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              title={
                query
                  ? 'Aucun traitement trouvé'
                  : 'Aucun traitement enregistré'
              }
              description={
                query
                  ? 'Modifiez votre recherche pour afficher d’autres traitements.'
                  : 'Ajoutez un traitement depuis le référentiel local. La posologie restera toujours à saisir manuellement.'
              }
            />
          ) : null
        }
        renderItem={({ item }) => <TreatmentItem treatment={item} />}
        ListFooterComponent={
          archivedTreatments.length > 0 ? (
            <View style={styles.archived}>
              <Text accessibilityRole="header" style={typography.heading}>
                Archivés
              </Text>
              <Text style={typography.caption}>
                Conservés pour préserver vos historiques.
              </Text>
              {archivedTreatments.map((item) => (
                <TreatmentItem key={item.id} treatment={item} />
              ))}
            </View>
          ) : null
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

function TreatmentItem({ treatment }: { treatment: Treatment }) {
  const summary = treatment.phases.map(humanPhaseSummary).join(' Puis ');
  return (
    <Link
      href={{
        pathname: '/treatments/[id]',
        params: { id: String(treatment.id) },
      }}
      style={styles.item}
    >
      <View style={styles.itemContent}>
        <Text style={styles.name}>{treatment.specialtyName}</Text>
        <View style={styles.badges}>
          {treatment.archivedAt ? (
            <Badge label="Archivé" tone="neutral" />
          ) : (
            <Badge
              label={
                treatment.includedInPillbox
                  ? 'Dans le pilulier'
                  : 'Hors pilulier'
              }
            />
          )}
        </View>
        <Text numberOfLines={2} style={styles.summary}>
          {summary}
        </Text>
      </View>
    </Link>
  );
}

const SLOT_LABELS = {
  morning: 'matin',
  noon: 'midi',
  evening: 'soir',
  bedtime: 'coucher',
} as const;
function humanPhaseSummary(phase: Treatment['phases'][number]): string {
  if (phase.frequency.type === 'legacy-weekdays')
    return `Posologie existante · ${phase.dosage.length} prise(s)`;
  const frequency =
    phase.frequency.type === 'daily'
      ? 'Chaque jour'
      : phase.frequency.type === 'interval'
        ? `Tous les ${phase.frequency.everyNDays} jours`
        : phase.frequency.weekday
          ? `Chaque ${phase.frequency.weekday}`
          : 'Jour hebdomadaire non renseigné';
  const dosage = phase.dosage
    .map(
      (item) =>
        `${formatHalfUnits(item.quantityHalfUnits)} ${SLOT_LABELS[item.slot]}`,
    )
    .join(', ');
  return `${frequency} · ${dosage}`;
}

const styles = StyleSheet.create({
  add: {
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    color: '#fff',
    fontWeight: '700',
    overflow: 'hidden',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, gap: spacing.xs },
  list: { gap: spacing.md, paddingBottom: spacing.xxl },
  archived: { gap: spacing.md, marginTop: spacing.xl },
  item: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    minHeight: 104,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  itemContent: { gap: spacing.xs },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  name: typography.heading,
  notice: {
    backgroundColor: '#dcfce7',
    color: '#166534',
    marginBottom: 12,
    padding: 12,
  },
  summary: { color: '#4b5563', marginTop: 6 },
});
