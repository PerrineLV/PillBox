import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

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
      <Stack.Screen options={{ headerShown: true, title: 'Mes traitements' }} />
      <Link href="/medications/search" style={styles.add}>
        Ajouter un traitement
      </Link>
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
        data={treatments}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              title="Aucun traitement enregistré"
              description="Ajoutez un traitement depuis le référentiel local. La posologie restera toujours à saisir manuellement."
            />
          ) : null
        }
        renderItem={({ item }) => <TreatmentItem treatment={item} />}
      />
    </View>
  );
}

function TreatmentItem({ treatment }: { treatment: Treatment }) {
  const summary = treatment.phases
    .map((phase) => {
      if (phase.frequency.type === 'legacy-weekdays')
        return `Posologie existante · ${phase.dosage.length} prise(s)`;
      const period = `${phase.startDate}${phase.endDate ? ` → ${phase.endDate}` : ' → sans fin'}`;
      const quantities = phase.dosage
        .map(
          (item) => `${item.slot}: ${formatHalfUnits(item.quantityHalfUnits)}`,
        )
        .join(', ');
      return `${period} · ${quantities}`;
    })
    .join(' · ');
  return (
    <Link
      href={{
        pathname: '/treatments/[id]',
        params: { id: String(treatment.id) },
      }}
      style={styles.item}
    >
      <View>
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

const styles = StyleSheet.create({
  add: {
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    color: '#fff',
    fontWeight: '700',
    marginBottom: 12,
    overflow: 'hidden',
    padding: 14,
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
  empty: { color: '#4b5563', paddingTop: 30, textAlign: 'center' },
  error: { color: '#b91c1c' },
  item: {
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
    paddingVertical: 16,
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
