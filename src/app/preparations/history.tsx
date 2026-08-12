import { router, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import {
  getPendingCompletionCases,
  listPreparationHistory,
  type PendingCompletionCase,
  type PreparationHistoryEntry,
} from '@/infrastructure/preparations/preparation-repository';
import {
  AppButton,
  Badge,
  Card,
  EmptyState,
  INTAKE_SLOT_LABELS,
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

/** Libellé compact « JJ mois · créneau » pour une case en attente de complément. */
function pendingItemLabel(
  item: PendingCompletionCase['pendingItems'][number],
): string {
  return `${formatLongFrenchCivilDate(item.date)} · ${INTAKE_SLOT_LABELS[item.slot]}`;
}

/** Section « en attente de complément » (ticket 30b), partagée entre un médicament déjà partiellement couvert et un médicament resté sans aucune boîte. */
function PendingCompletionSection({
  pending,
}: {
  pending: PendingCompletionCase;
}) {
  return (
    <View style={styles.pending}>
      <Badge label="En attente de complément" tone="warning" />
      {pending.theoreticalRenewalDate ? (
        <Text style={styles.muted}>
          Renouvellement théorique (délivrance encadrée) :{' '}
          {formatLongFrenchCivilDate(pending.theoreticalRenewalDate)}
        </Text>
      ) : null}
      <Text>
        Cases non couvertes ({formatHalfUnits(pending.pendingHalfUnits)}) :
      </Text>
      {pending.pendingItems.map((item) => (
        <Text key={`${item.date}-${item.slot}`} style={styles.pendingItem}>
          • {pendingItemLabel(item)}
        </Text>
      ))}
      <AppButton
        label="Compléter"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/preparations/complete',
            params: {
              preparationId: String(pending.preparationId),
              specialtyCis: pending.specialtyCis,
            },
          })
        }
      />
    </View>
  );
}

export default function PreparationHistoryScreen() {
  const database = useSQLiteContext();
  const [history, setHistory] = useState<PreparationHistoryEntry[]>([]);
  const [pendingCases, setPendingCases] = useState<
    readonly PendingCompletionCase[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [items, pending] = await Promise.all([
        listPreparationHistory(database),
        getPendingCompletionCases(database),
      ]);
      setHistory(items);
      setPendingCases(pending);
      setError(null);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Historique inaccessible.',
      );
    } finally {
      setLoading(false);
    }
  }, [database]);

  // Rechargé à chaque focus, pas seulement au montage : un complément
  // effectué sur l'écran dédié (ticket 30b) doit se refléter au retour ici.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
      {history.map((preparation) => {
        const groups = groupBySpecialty(preparation.medications);
        const pendingForPreparation = pendingCases.filter(
          (item) => item.preparationId === preparation.id,
        );
        const coveredSpecialtyCis = new Set(
          groups.map((group) => group.specialtyCis),
        );
        // Un médicament à délivrance encadrée resté sans aucune boîte
        // (ticket 30b) n'a aucun lot à afficher ci-dessous : il apparaît
        // uniquement via cette section dédiée.
        const uncoveredPending = pendingForPreparation.filter(
          (item) => !coveredSpecialtyCis.has(item.specialtyCis),
        );
        return (
          <Card key={preparation.id} style={styles.card}>
            <Text style={styles.title}>
              Du {formatLongFrenchCivilDate(preparation.startDate)} au{' '}
              {formatLongFrenchCivilDate(preparation.endDate)}
            </Text>
            <Text style={styles.muted}>
              Validée le {formatFrenchDateTime(preparation.completedAt)}
            </Text>
            {groups.map((group) => {
              const pending = pendingForPreparation.find(
                (item) => item.specialtyCis === group.specialtyCis,
              );
              return (
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
                  {pending ? (
                    <PendingCompletionSection pending={pending} />
                  ) : null}
                </View>
              );
            })}
            {uncoveredPending.map((pending) => (
              <View key={pending.specialtyCis} style={styles.medication}>
                <Text style={styles.name}>{pending.specialtyName}</Text>
                <PendingCompletionSection pending={pending} />
              </View>
            ))}
          </Card>
        );
      })}
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
  pending: {
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    gap: spacing.xs,
    marginTop: 8,
    padding: 10,
  },
  pendingItem: { color: '#4b5563' },
  title: typography.heading,
  usage: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    marginTop: 6,
    paddingTop: 6,
  },
});
