import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  getPendingCompletionCases,
  listPreparationHistory,
  type PendingCompletionCase,
  type PreparationHistoryEntry,
} from '@/infrastructure/preparations/preparation-repository';
import {
  AppCard,
  AppScreen,
  EmptyState,
  INTAKE_SLOT_LABELS,
  LoadingState,
  Message,
  PillButton,
  SeverityBadge,
  StackHeader,
  colors,
  radii,
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

  // Rechargé à chaque focus : un complément effectué sur l'écran dédié doit
  // se refléter au retour ici.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle={`${history.length} préparation${history.length > 1 ? 's' : ''} validée${history.length > 1 ? 's' : ''}`}
          title="Préparations passées"
        />
      }
    >
      {loading ? <LoadingState label="Chargement de l’historique…" /> : null}
      {error ? (
        <Message tone="error" title="Historique indisponible">
          {error}
        </Message>
      ) : null}
      {!loading && !error && history.length === 0 ? (
        <EmptyState
          description="Les préparations validées et les lots utilisés apparaîtront ici."
          title="Aucune préparation terminée"
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
        // Un médicament à délivrance encadrée resté sans aucune boîte n'a
        // aucun lot à afficher : il apparaît uniquement via la section dédiée.
        const uncoveredPending = pendingForPreparation.filter(
          (item) => !coveredSpecialtyCis.has(item.specialtyCis),
        );
        const totalHalfUnits = preparation.medications.reduce(
          (sum, medication) => sum + medication.quantityHalfUnits,
          0,
        );
        return (
          <AppCard key={preparation.id}>
            <View style={styles.head}>
              <Text style={styles.period}>
                Du {formatLongFrenchCivilDate(preparation.startDate)} au{' '}
                {formatLongFrenchCivilDate(preparation.endDate)}
              </Text>
              <Text style={styles.total}>
                {formatHalfUnits(totalHalfUnits)} unité(s)
              </Text>
            </View>
            <Text style={typography.micro}>
              Validée le {formatFrenchDateTime(preparation.completedAt)}
            </Text>

            {groups.map((group) => {
              const pending = pendingForPreparation.find(
                (item) => item.specialtyCis === group.specialtyCis,
              );
              return (
                <View key={group.specialtyCis} style={styles.medication}>
                  <View style={styles.medicationHead}>
                    <Text style={styles.name}>{group.specialtyName}</Text>
                    <Text style={styles.quantity}>
                      {formatHalfUnits(group.totalQuantityHalfUnits)} unité(s)
                      {group.usages.length > 1
                        ? ` · ${group.usages.length} boîtes`
                        : ''}
                    </Text>
                  </View>
                  {group.usages.map((usage) => (
                    <View key={usage.boxId} style={styles.usage}>
                      <View style={styles.usageHead}>
                        <Text style={styles.usageLot}>
                          Lot {usage.lot ?? 'non renseigné'} ·{' '}
                          {formatHalfUnits(usage.quantityHalfUnits)} unité(s)
                        </Text>
                        <SeverityBadge
                          label={
                            usage.verification === 'SCAN' ? 'Scan' : 'Sans scan'
                          }
                          level={
                            usage.verification === 'SCAN' ? 'ok' : 'neutral'
                          }
                        />
                      </View>
                      <Text style={typography.micro}>
                        Péremption{' '}
                        {formatLongFrenchCivilDate(usage.expirationDate)} ·{' '}
                        {usage.presentationLabel} ({usage.presentationCip13})
                      </Text>
                      {usage.matchedSpecialtyName ? (
                        <Text style={typography.micro}>
                          Équivalence générique confirmée :{' '}
                          {usage.matchedSpecialtyName}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                  {pending ? <PendingCompletion pending={pending} /> : null}
                </View>
              );
            })}

            {uncoveredPending.map((pending) => (
              <View key={pending.specialtyCis} style={styles.medication}>
                <Text style={styles.name}>{pending.specialtyName}</Text>
                <PendingCompletion pending={pending} />
              </View>
            ))}
          </AppCard>
        );
      })}
    </AppScreen>
  );
}

function PendingCompletion({
  pending,
}: Readonly<{ pending: PendingCompletionCase }>) {
  return (
    <View style={styles.pending}>
      <SeverityBadge label="En attente de complément" level="warning" />
      <Text style={styles.pendingTotal}>
        {formatHalfUnits(pending.pendingHalfUnits)} unité(s) non couvertes
      </Text>
      <View style={styles.pendingItems}>
        {pending.pendingItems.map((item) => (
          <View key={`${item.date}-${item.slot}`} style={styles.pendingItem}>
            <Text style={styles.pendingItemText}>
              {formatLongFrenchCivilDate(item.date)} ·{' '}
              {INTAKE_SLOT_LABELS[item.slot]}
            </Text>
          </View>
        ))}
      </View>
      {pending.theoreticalRenewalDate ? (
        <Text style={styles.pendingRenewal}>
          Renouvellement théorique (délivrance encadrée) :{' '}
          {formatLongFrenchCivilDate(pending.theoreticalRenewalDate)}
        </Text>
      ) : null}
      <PillButton
        height={44}
        label="Compléter"
        onPress={() =>
          router.push({
            pathname: '/preparations/complete',
            params: {
              preparationId: String(pending.preparationId),
              specialtyCis: pending.specialtyCis,
            },
          })
        }
        tone="outline"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  period: {
    ...typography.itemTitle,
    flex: 1,
    fontSize: 15.5,
    lineHeight: 19,
    minWidth: 0,
  },
  total: {
    ...typography.numeric,
    color: colors.brand,
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 14,
  },
  medication: {
    borderTopColor: colors.hairline,
    borderTopWidth: 1,
    gap: 7,
    marginTop: 5,
    paddingTop: 11,
  },
  medicationHead: { gap: 3 },
  name: { ...typography.itemTitle, fontSize: 14, lineHeight: 18 },
  quantity: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
  },
  usage: {
    backgroundColor: colors.background,
    borderRadius: radii.tile,
    gap: 4,
    padding: 11,
  },
  usageHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  usageLot: {
    ...typography.itemTitle,
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    minWidth: 0,
  },
  pending: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.banner,
    gap: 7,
    padding: 12,
  },
  pendingTotal: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  pendingItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  pendingItem: {
    backgroundColor: 'rgba(255, 253, 249, 0.72)',
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pendingItemText: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  pendingRenewal: {
    color: colors.warning,
    fontSize: 11.5,
    fontWeight: '500',
    lineHeight: 15,
  },
});
