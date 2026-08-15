import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  buildAttachedSpecialtyCisSet,
  isOrphanBox,
} from '@/domain/inventory/box-attachment';
import {
  isExpired,
  todayIso,
  usableQuantity,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import type { PrescriptionItem } from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listPreparationWeeks } from '@/infrastructure/preparations/preparation-repository';
import { listPrescriptionItems } from '@/infrastructure/prescriptions/prescription-repository';
import { listAllGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { buildInventoryAlerts } from '@/domain/alerts/inventory-alerts';
import {
  buildStockForecast,
  type StockForecast,
} from '@/domain/forecast/stock-forecast';
import { buildRenewalList } from '@/domain/renewal/renewal-list';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { StockForecastCard } from '@/components/inventory/stock-forecast-card';
import { StockForecastSummary } from '@/components/inventory/stock-forecast-summary';
import { RenewalList } from '@/components/inventory/renewal-list';
import {
  Badge,
  Card,
  EmptyState,
  LoadingState,
  Message,
  colors,
  radii,
  sizes,
  spacing,
  typography,
} from '@/ui';

export default function InventoryScreen() {
  const database = useSQLiteContext();
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiringBoxIds, setExpiringBoxIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'renew' | 'expiring'>('all');
  const [forecast, setForecast] = useState<StockForecast | null>(null);
  const [attachedCis, setAttachedCis] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [prescriptionItems, setPrescriptionItems] = useState<
    PrescriptionItem[]
  >([]);

  // Une carte d'attention de l'accueil peut ouvrir directement l'onglet
  // « À renouveler » : le paramètre n'est appliqué qu'aux valeurs connues.
  useFocusEffect(
    useCallback(() => {
      if (filterParam === 'renew' || filterParam === 'expiring')
        setFilter(filterParam);
    }, [filterParam]),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        listMedicationBoxes(database),
        listTreatments(database),
        listPreparationWeeks(database),
        listAllGenericEquivalenceConfirmations(database),
        listPrescriptionItems(database),
      ])
        .then(
          ([
            items,
            treatments,
            preparations,
            equivalenceConfirmations,
            fetchedPrescriptionItems,
          ]) => {
            if (active) {
              setBoxes(items);
              setTreatments(treatments);
              setPrescriptionItems(fetchedPrescriptionItems);
              const today = todayIso();
              const equivalences = equivalenceConfirmations.map(
                (confirmation) => ({
                  treatmentId: confirmation.treatmentId,
                  cis: confirmation.cis,
                }),
              );
              const alerts = buildInventoryAlerts(treatments, items, today, {
                equivalences,
              });
              setExpiringBoxIds(
                new Set(alerts.expirations.map((item) => item.boxId)),
              );
              setForecast(
                buildStockForecast(treatments, items, today, preparations, {
                  equivalences,
                }),
              );
              setAttachedCis(
                buildAttachedSpecialtyCisSet(treatments, equivalences),
              );
              setError(null);
            }
          },
        )
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

  const forecastsByCis = useMemo(
    () =>
      new Map(
        (forecast?.medications ?? []).map((item) => [item.specialtyCis, item]),
      ),
    [forecast],
  );
  // Une boîte épuisée n'a plus aucune utilité opérationnelle sur cet écran
  // (ticket 49) : masquée de l'affichage (liste, regroupements, compteur),
  // jamais supprimée — son historique reste consultable depuis la
  // Chronologie, et la fiche boîte reste accessible par un lien direct.
  const visibleBoxes = useMemo(
    () => boxes.filter((box) => box.remainingQuantity > 0),
    [boxes],
  );
  const filteredBoxes = useMemo(
    () =>
      visibleBoxes.filter(
        (box) =>
          filter === 'all' ||
          (filter === 'expiring' && expiringBoxIds.has(box.id)),
      ),
    [visibleBoxes, expiringBoxIds, filter],
  );
  const groups = useMemo(() => groupBoxes(filteredBoxes), [filteredBoxes]);
  const today = todayIso();
  const renewalList = useMemo(
    () =>
      forecast
        ? buildRenewalList(
            forecast,
            treatments,
            prescriptionItems,
            boxes,
            today,
          )
        : [],
    [forecast, treatments, prescriptionItems, boxes, today],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={typography.title}>
            Stock
          </Text>
          <Text style={typography.caption}>
            {visibleBoxes.length} boîte{visibleBoxes.length > 1 ? 's' : ''}{' '}
            enregistrée{visibleBoxes.length > 1 ? 's' : ''}
          </Text>
        </View>
        <Link href="/inventory/new" style={styles.add}>
          Ajouter
        </Link>
      </View>
      {forecast ? <StockForecastSummary forecast={forecast} /> : null}
      <View style={styles.filters}>
        <Filter
          label="Tout"
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <Filter
          label="À renouveler"
          selected={filter === 'renew'}
          onPress={() => setFilter('renew')}
        />
        <Filter
          label="Périme bientôt"
          selected={filter === 'expiring'}
          onPress={() => setFilter('expiring')}
        />
      </View>
      {loading ? <LoadingState label="Chargement du stock…" /> : null}
      {error ? (
        <Message tone="error" title="Stock indisponible">
          {error}
        </Message>
      ) : null}
      {!loading && !error && filter === 'renew' ? (
        <RenewalList items={renewalList} />
      ) : null}
      {!loading && !error && filter !== 'renew' && visibleBoxes.length === 0 ? (
        <EmptyState
          title="Aucune boîte enregistrée"
          description="Scannez le DataMatrix d’une boîte, ou ajoutez-la sans DataMatrix, pour suivre son lot, sa péremption et sa quantité."
        />
      ) : null}
      {!loading &&
      !error &&
      filter !== 'renew' &&
      visibleBoxes.length > 0 &&
      groups.length === 0 ? (
        <EmptyState
          title="Aucune boîte pour ce filtre"
          description="Essayez un autre filtre pour retrouver le reste du stock."
        />
      ) : null}
      {filter !== 'renew' &&
        groups.map((medication) => {
          const medicationForecast = forecastsByCis.get(medication.cis);
          return (
            <View key={medication.cis} style={styles.medication}>
              <Text style={styles.medicationName}>{medication.name}</Text>
              {medicationForecast ? (
                <StockForecastCard forecast={medicationForecast} />
              ) : null}
              {medication.lots.map((lot) => {
                const usable = lot.boxes.reduce(
                  (sum, box) => sum + usableQuantity(box, today),
                  0,
                );
                return (
                  <Card key={lot.key} style={styles.lot} tone="muted">
                    <Text style={styles.lotTitle}>Lot {lot.label}</Text>
                    <Text style={styles.usable}>
                      Stock utilisable : {usable}
                    </Text>
                    {lot.boxes.map((box) => {
                      const expired = isExpired(box.expirationDate, today);
                      const orphan = isOrphanBox(box, attachedCis);
                      return (
                        <Link
                          key={box.id}
                          href={{
                            pathname: '/inventory/[id]',
                            params: { id: String(box.id) },
                          }}
                          style={[styles.box, expired && styles.expiredBox]}
                        >
                          <View>
                            <Text style={styles.boxTitle}>
                              Boîte #{box.id} · {box.remainingQuantity}/
                              {box.initialQuantity}
                            </Text>
                            <Text>
                              Péremption :{' '}
                              {formatLongFrenchCivilDate(box.expirationDate)}
                            </Text>
                            <Text>
                              {box.origin === 'SCAN'
                                ? 'Ajoutée par scan DataMatrix'
                                : 'Ajoutée manuellement, sans scan'}
                            </Text>
                            {expired ? (
                              <Badge
                                label="Périmée — stock inutilisable"
                                tone="danger"
                              />
                            ) : null}
                            {!expired && orphan ? (
                              <Badge
                                label="Aucun traitement actif associé"
                                tone="warning"
                              />
                            ) : null}
                          </View>
                        </Link>
                      );
                    })}
                  </Card>
                );
              })}
            </View>
          );
        })}
    </ScrollView>
  );
}

function Filter({
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
      style={[styles.filter, selected && styles.filterSelected]}
    >
      <Text style={[typography.caption, selected && styles.filterTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

type MedicationGroup = {
  cis: string;
  name: string;
  lots: { key: string; label: string; boxes: MedicationBox[] }[];
};

function groupBoxes(boxes: readonly MedicationBox[]): MedicationGroup[] {
  const medications = new Map<string, MedicationGroup>();
  for (const box of boxes) {
    let medication = medications.get(box.specialtyCis);
    if (!medication) {
      medication = { cis: box.specialtyCis, name: box.specialtyName, lots: [] };
      medications.set(box.specialtyCis, medication);
    }
    const key = box.lot ?? '__absent__';
    let lot = medication.lots.find((item) => item.key === key);
    if (!lot) {
      lot = { key, label: box.lot ?? 'non renseigné', boxes: [] };
      medication.lots.push(lot);
    }
    lot.boxes.push(box);
  }
  return [...medications.values()];
}

const styles = StyleSheet.create({
  add: {
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    color: colors.surface,
    fontWeight: '700',
    overflow: 'hidden',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  box: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingVertical: spacing.md,
  },
  boxTitle: { fontWeight: '700' },
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, gap: spacing.xs },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  filter: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
  },
  filterSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterTextSelected: { color: colors.surface, fontWeight: '700' },
  expiredBox: { backgroundColor: colors.dangerSoft },
  lot: { marginTop: spacing.sm },
  lotTitle: { fontSize: 16, fontWeight: '700' },
  medication: { marginBottom: 24 },
  medicationName: typography.heading,
  usable: { color: colors.brand, fontWeight: '700', marginBottom: 4 },
});
