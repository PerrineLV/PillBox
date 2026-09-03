import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RenewalList } from '@/components/inventory/renewal-list';
import {
  forecastAlertBadge,
  forecastCoverageLabel,
  forecastSummary,
} from '@/components/inventory/forecast-labels';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { buildInventoryAlerts } from '@/domain/alerts/inventory-alerts';
import {
  buildStockForecast,
  type MedicationForecast,
  type StockForecast,
} from '@/domain/forecast/stock-forecast';
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
import { buildRenewalList } from '@/domain/renewal/renewal-list';
import type { Treatment } from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listPreparationWeeks } from '@/infrastructure/preparations/preparation-repository';
import { listPrescriptionItems } from '@/infrastructure/prescriptions/prescription-repository';
import { listAllGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppCard,
  AppScreen,
  Banner,
  DenseRow,
  EmptyState,
  FilterPills,
  FloatingAction,
  LoadingState,
  Message,
  ProgressBar,
  SeverityBadge,
  TabHeader,
  WarningIcon,
  colors,
  severity as severityScale,
  typography,
  type SeverityLevel,
} from '@/ui';

type Filter = 'all' | 'renew' | 'expiring';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'renew', label: 'À renouveler' },
  { value: 'expiring', label: 'Périme bientôt' },
];

export default function InventoryScreen() {
  const database = useSQLiteContext();
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiringBoxIds, setExpiringBoxIds] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [forecast, setForecast] = useState<StockForecast | null>(null);
  const [attachedCis, setAttachedCis] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [prescriptionItems, setPrescriptionItems] = useState<
    PrescriptionItem[]
  >([]);

  // Une alerte de l'accueil peut ouvrir directement « À renouveler » : le
  // paramètre n'est appliqué qu'aux valeurs connues.
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
            loadedTreatments,
            preparations,
            equivalenceConfirmations,
            loadedPrescriptionItems,
          ]) => {
            if (!active) return;
            const today = todayIso();
            const equivalences = equivalenceConfirmations.map(
              (confirmation) => ({
                treatmentId: confirmation.treatmentId,
                cis: confirmation.cis,
              }),
            );
            setBoxes(items);
            setTreatments(loadedTreatments);
            setPrescriptionItems(loadedPrescriptionItems);
            setExpiringBoxIds(
              new Set(
                buildInventoryAlerts(loadedTreatments, items, today, {
                  equivalences,
                }).expirations.map((expiration) => expiration.boxId),
              ),
            );
            setForecast(
              buildStockForecast(loadedTreatments, items, today, preparations, {
                equivalences,
              }),
            );
            setAttachedCis(
              buildAttachedSpecialtyCisSet(loadedTreatments, equivalences),
            );
            setError(null);
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

  const today = todayIso();
  const forecastsByCis = useMemo(
    () =>
      new Map(
        (forecast?.medications ?? []).map((item) => [item.specialtyCis, item]),
      ),
    [forecast],
  );
  // Une boîte épuisée n'a plus d'utilité opérationnelle : masquée ici,
  // jamais supprimée — sa fiche et son historique restent accessibles.
  const visibleBoxes = useMemo(
    () => boxes.filter((box) => box.remainingQuantity > 0),
    [boxes],
  );
  const groups = useMemo(
    () =>
      groupByMedication(
        visibleBoxes.filter(
          (box) => filter !== 'expiring' || expiringBoxIds.has(box.id),
        ),
      ),
    [visibleBoxes, expiringBoxIds, filter],
  );
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
  const summary = forecast ? forecastSummary(forecast) : null;

  return (
    <AppScreen
      floatingAction={
        <FloatingAction
          accessibilityLabel="Ajouter une boîte au stock"
          href="/inventory/new"
          label="Boîte"
        />
      }
      header={
        <TabHeader
          subtitle={`${visibleBoxes.length} boîte${visibleBoxes.length > 1 ? 's' : ''} en stock`}
          title="Stock"
        />
      }
    >
      {summary ? (
        <Banner
          compact
          icon={
            summary.alertCount > 0 ? (
              <WarningIcon color={colors.warning} size={16} />
            ) : undefined
          }
          level={summary.alertCount > 0 ? 'warning' : 'ok'}
        >
          {summary.label}
        </Banner>
      ) : null}
      <FilterPills
        accessibilityLabel="Filtrer le stock"
        onChange={(next) => setFilter(next)}
        options={FILTERS}
        value={filter}
      />
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
          description="Scannez le DataMatrix d’une boîte, ou ajoutez-la sans DataMatrix, pour suivre son lot, sa péremption et sa quantité."
          title="Aucune boîte enregistrée"
        />
      ) : null}
      {!loading &&
      !error &&
      filter !== 'renew' &&
      visibleBoxes.length > 0 &&
      groups.length === 0 ? (
        <EmptyState
          description="Essayez un autre filtre pour retrouver le reste du stock."
          title="Aucune boîte pour ce filtre"
        />
      ) : null}
      {filter !== 'renew'
        ? groups.map((group) => (
            <MedicationStockCard
              attachedCis={attachedCis}
              forecast={forecastsByCis.get(group.cis) ?? null}
              group={group}
              key={group.cis}
              today={today}
            />
          ))
        : null}
    </AppScreen>
  );
}

function MedicationStockCard({
  group,
  forecast,
  attachedCis,
  today,
}: Readonly<{
  group: MedicationGroup;
  forecast: MedicationForecast | null;
  attachedCis: ReadonlySet<string>;
  today: string;
}>) {
  const usable = group.boxes.reduce(
    (total, box) => total + usableQuantity(box, today),
    0,
  );
  const badge = forecast ? forecastAlertBadge(forecast) : null;
  const level: SeverityLevel =
    badge === null ? 'ok' : badge.tone === 'danger' ? 'high' : 'warning';
  const lots = [...new Set(group.boxes.map((box) => box.lot ?? 'sans lot'))];
  const nextExpiration = group.boxes
    .map((box) => box.expirationDate)
    .sort()
    .at(0);
  return (
    <AppCard style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.medicationName}>{group.name}</Text>
        <View style={styles.quantity}>
          <Text
            style={[styles.quantityValue, { color: severityScale[level].text }]}
          >
            {usable}
          </Text>
          <Text style={styles.quantityUnit}>unité(s)</Text>
        </View>
      </View>
      <ProgressBar
        color={severityScale[level].text}
        ratio={coverageRatio(forecast)}
      />
      <View style={styles.detailRow}>
        <Text style={styles.detail}>
          {lots.length} lot{lots.length > 1 ? 's' : ''} ·{' '}
          {nextExpiration
            ? `péremption la plus proche le ${formatLongFrenchCivilDate(nextExpiration)}`
            : 'aucune péremption connue'}
        </Text>
        {badge ? <SeverityBadge label={badge.label} level={level} /> : null}
      </View>
      {forecast ? (
        <Text style={typography.micro}>
          {forecastCoverageLabel(forecast.coverage)}
        </Text>
      ) : null}
      <View style={styles.boxes}>
        {group.boxes.map((box, index) => (
          <DenseRow
            chevron
            detail={`${box.remainingQuantity}/${box.initialQuantity} · périme le ${formatLongFrenchCivilDate(box.expirationDate)} · ${box.origin === 'SCAN' ? 'scan' : 'saisie manuelle'}`}
            first={index === 0}
            href={{
              pathname: '/inventory/[id]',
              params: { id: String(box.id) },
            }}
            key={box.id}
            title={`Boîte #${box.id} · lot ${box.lot ?? 'non renseigné'}`}
            trailing={
              isExpired(box.expirationDate, today) ? (
                <SeverityBadge label="Périmée" level="high" />
              ) : isOrphanBox(box, attachedCis) ? (
                <SeverityBadge label="Sans traitement" level="warning" />
              ) : undefined
            }
          />
        ))}
      </View>
    </AppCard>
  );
}

/**
 * Part du besoin de la prochaine préparation déjà couverte par le stock
 * utilisable. Sans besoin connu, la barre est pleine : rien ne manque.
 */
function coverageRatio(forecast: MedicationForecast | null): number {
  if (forecast === null || forecast.nextPreparationHalfUnits === 0) return 1;
  return forecast.availableHalfUnits / forecast.nextPreparationHalfUnits;
}

type MedicationGroup = Readonly<{
  cis: string;
  name: string;
  boxes: MedicationBox[];
}>;

function groupByMedication(boxes: readonly MedicationBox[]): MedicationGroup[] {
  const groups = new Map<
    string,
    { cis: string; name: string; boxes: MedicationBox[] }
  >();
  for (const box of boxes) {
    const existing = groups.get(box.specialtyCis) ?? {
      cis: box.specialtyCis,
      name: box.specialtyName,
      boxes: [],
    };
    existing.boxes.push(box);
    groups.set(box.specialtyCis, existing);
  }
  // FEFO : la boîte qui périme en premier est celle qu'on utilisera d'abord.
  for (const group of groups.values())
    group.boxes.sort((left, right) =>
      left.expirationDate.localeCompare(right.expirationDate),
    );
  return [...groups.values()];
}

const styles = StyleSheet.create({
  /** Densité propre au stock : une carte par médicament, resserrée. */
  card: { padding: 14 },
  cardHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  medicationName: {
    ...typography.itemTitle,
    flex: 1,
    fontSize: 15.5,
    minWidth: 0,
  },
  quantity: { alignItems: 'baseline', flexDirection: 'row', gap: 4 },
  quantityValue: {
    ...typography.numeric,
    fontSize: 19,
    lineHeight: 21,
  },
  quantityUnit: {
    color: colors.textTertiary,
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 13,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  detail: { ...typography.detail, flex: 1, minWidth: 0 },
  boxes: {
    borderTopColor: colors.hairline,
    borderTopWidth: 1,
    marginTop: 2,
  },
});
