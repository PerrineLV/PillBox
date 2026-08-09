import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatHalfUnits, type Treatment } from '@/domain/treatments/treatment';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';

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
      {loading ? <ActivityIndicator /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <FlatList
        data={treatments}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.empty}>Aucun traitement enregistré.</Text>
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
        <Text>
          {treatment.archivedAt
            ? 'Archivé'
            : treatment.active
              ? 'Actif'
              : 'Inactif'}{' '}
          ·{' '}
          {treatment.includedInPillbox
            ? 'Dans le pilulier'
            : 'Exclu du pilulier'}
        </Text>
        <Text numberOfLines={2} style={styles.summary}>
          {summary}
        </Text>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  add: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    color: '#fff',
    fontWeight: '700',
    marginBottom: 12,
    overflow: 'hidden',
    padding: 14,
    textAlign: 'center',
  },
  container: { backgroundColor: '#fff', flex: 1, padding: 16 },
  empty: { color: '#4b5563', paddingTop: 30, textAlign: 'center' },
  error: { color: '#b91c1c' },
  item: {
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
    paddingVertical: 16,
  },
  name: { fontSize: 17, fontWeight: '700' },
  notice: {
    backgroundColor: '#dcfce7',
    color: '#166534',
    marginBottom: 12,
    padding: 12,
  },
  summary: { color: '#4b5563', marginTop: 6 },
});
