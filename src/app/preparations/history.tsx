import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
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

type MedicationUsage = PreparationHistoryEntry['medications'][number];

/**
 * Regroupe les lots utilisés par médicament : un médicament dont la boîte
 * s'est terminée en cours de préparation est couvert par plusieurs lots, qui
 * doivent rester distinguables sans se dupliquer dans l'affichage.
 */
function groupBySpecialty(medications: readonly MedicationUsage[]): readonly {
  specialtyCis: string;
  specialtyName: string;
  totalQuantityHalfUnits: number;
  usages: readonly MedicationUsage[];
}[] {
  const order: string[] = [];
  const groups = new Map<
    string,
    { specialtyName: string; usages: MedicationUsage[] }
  >();
  for (const medication of medications) {
    const group = groups.get(medication.specialtyCis);
    if (group) {
      group.usages.push(medication);
    } else {
      order.push(medication.specialtyCis);
      groups.set(medication.specialtyCis, {
        specialtyName: medication.specialtyName,
        usages: [medication],
      });
    }
  }
  return order.map((specialtyCis) => {
    const group = groups.get(specialtyCis)!;
    return {
      specialtyCis,
      specialtyName: group.specialtyName,
      totalQuantityHalfUnits: group.usages.reduce(
        (sum, usage) => sum + usage.quantityHalfUnits,
        0,
      ),
      usages: group.usages,
    };
  });
}

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
            Du {formatLongFrenchCivilDate(preparation.startDate)} au{' '}
            {formatLongFrenchCivilDate(preparation.endDate)}
          </Text>
          <Text style={styles.muted}>
            Validée le {formatFrenchDateTime(preparation.completedAt)}
          </Text>
          {groupBySpecialty(preparation.medications).map((group) => (
            <View key={group.specialtyCis} style={styles.medication}>
              <Text style={styles.name}>{group.specialtyName}</Text>
              <Text>
                Quantité totale :{' '}
                {formatHalfUnits(group.totalQuantityHalfUnits)}
                {group.usages.length > 1
                  ? ` (${group.usages.length} boîtes)`
                  : ''}
              </Text>
              {group.usages.map((usage) => (
                <View key={usage.boxId} style={styles.usage}>
                  <Text>
                    Lot {usage.lot ?? 'non renseigné'} ·{' '}
                    {formatHalfUnits(usage.quantityHalfUnits)}
                  </Text>
                  <Text>
                    Péremption :{' '}
                    {formatLongFrenchCivilDate(usage.expirationDate)}
                  </Text>
                  <Text>
                    Présentation : {usage.presentationLabel} (
                    {usage.presentationCip13})
                  </Text>
                  <Text>
                    Vérification :{' '}
                    {usage.verification === 'SCAN'
                      ? 'scan DataMatrix'
                      : 'boîte choisie dans le stock, sans scan'}
                  </Text>
                </View>
              ))}
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
  medication: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10,
  },
  muted: { color: '#4b5563', marginTop: 3 },
  name: { fontWeight: '700' },
  title: typography.heading,
  usage: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    marginTop: 6,
    paddingTop: 6,
  },
});
