import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  listPreparationHistory,
  type PreparationHistoryEntry,
} from '@/infrastructure/preparations/preparation-repository';
import {
  Card,
  EmptyState,
  LoadingState,
  Message,
  colors,
  spacing,
  typography,
} from '@/ui';

export default function PreparationHistoryScreen() {
  const database = useSQLiteContext();
  const [history, setHistory] = useState<PreparationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listPreparationHistory(database)
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Historique inaccessible.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [database]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Historique' }} />
      {loading ? <LoadingState label="Chargement de l’historique…" /> : null}
      {error ? (
        <Message tone="error" title="Historique indisponible">
          {error}
        </Message>
      ) : null}
      {!loading && !error && history.length === 0 ? (
        <EmptyState
          title="Aucune préparation terminée"
          description="Les préparations validées et les lots utilisés apparaîtront ici."
        />
      ) : null}
      {history.map((preparation) => (
        <Card key={preparation.id} style={styles.card}>
          <Text style={styles.title}>
            Du {preparation.startDate} au {preparation.endDate}
          </Text>
          <Text style={styles.muted}>Validée le {preparation.completedAt}</Text>
          {preparation.medications.map((medication) => (
            <View key={medication.specialtyCis} style={styles.medication}>
              <Text style={styles.name}>{medication.specialtyName}</Text>
              <Text>
                Quantité : {formatHalfUnits(medication.quantityHalfUnits)}
              </Text>
              <Text>Lot : {medication.lot ?? 'non renseigné'}</Text>
              <Text>Péremption : {medication.expirationDate}</Text>
              <Text>
                Présentation : {medication.presentationLabel} (
                {medication.presentationCip13})
              </Text>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  error: { color: '#b91c1c', fontWeight: '700' },
  medication: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10,
  },
  muted: { color: '#4b5563', marginTop: 3 },
  name: { fontWeight: '700' },
  title: typography.heading,
});
