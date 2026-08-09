import { Link, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildInventoryAlerts,
  type InventoryAlerts,
} from '@/domain/alerts/inventory-alerts';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import { todayIso } from '@/domain/inventory/inventory';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import {
  getLatestDraftPreparation,
  listPreparationHistory,
  type PreparationHistoryEntry,
  type SavedPreparation,
} from '@/infrastructure/preparations/preparation-repository';
import {
  AppButton,
  Badge,
  Card,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

export default function HomeScreen() {
  const database = useSQLiteContext();
  const [alerts, setAlerts] = useState<InventoryAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavedPreparation | null>(null);
  const [lastPreparation, setLastPreparation] =
    useState<PreparationHistoryEntry | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        listTreatments(database),
        listMedicationBoxes(database),
        getLatestDraftPreparation(database),
        listPreparationHistory(database),
      ])
        .then(([treatments, boxes, savedDraft, history]) => {
          if (!active) return;
          setAlerts(buildInventoryAlerts(treatments, boxes, todayIso()));
          setDraft(savedDraft);
          setLastPreparation(history[0] ?? null);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(
            reason instanceof Error
              ? reason.message
              : 'Chargement des alertes impossible.',
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
    <HomeContent
      alerts={alerts}
      loading={loading}
      error={error}
      draft={draft}
      lastPreparation={lastPreparation}
    />
  );
}

export function HomeContent({
  alerts,
  loading,
  error,
  draft = null,
  lastPreparation = null,
}: Readonly<{
  alerts: InventoryAlerts | null;
  loading: boolean;
  error: string | null;
  draft?: SavedPreparation | null;
  lastPreparation?: PreparationHistoryEntry | null;
}>) {
  const completedCount = draft?.progress.length ?? 0;
  const totalCount = draft?.snapshot.requirements.length ?? 0;
  return (
    <Screen
      fixedHeader={
        <View style={styles.hero}>
          <View style={styles.mark} accessibilityElementsHidden>
            <View style={styles.markTop} />
            <View style={styles.markBottom} />
          </View>
          <View style={styles.heroText}>
            <Text accessibilityRole="header" style={styles.title}>
              PillBox
            </Text>
            <Text style={styles.subtitle}>
              Votre pilulier, simplement et sûrement.
            </Text>
          </View>
        </View>
      }
    >
      {loading ? <LoadingState label="Chargement de votre situation…" /> : null}
      {error ? (
        <Message tone="error" title="Alertes indisponibles">
          {error}
        </Message>
      ) : null}
      {!loading ? (
        <Card style={styles.preparationCard}>
          <Badge
            label={draft ? 'Préparation en cours' : 'Prochaine préparation'}
            tone={draft ? 'warning' : 'neutral'}
          />
          <Text style={styles.preparationTitle}>
            {draft
              ? `Pilulier du ${formatDate(draft.snapshot.startDate)} au ${formatDate(draft.snapshot.endDate)}`
              : 'Préparer les 7 prochains jours'}
          </Text>
          <Text style={styles.preparationBody}>
            {draft
              ? `${completedCount} médicament${completedCount > 1 ? 's' : ''} vérifié${completedCount > 1 ? 's' : ''} sur ${totalCount}. Votre progression est enregistrée.`
              : 'Vérifiez chaque boîte et chaque lot avant la validation finale.'}
          </Text>
          <AppButton
            label={draft ? 'Reprendre la préparation' : 'Commencer'}
            variant="secondary"
            onPress={() => router.push('/preparations/new')}
            accessibilityHint="Ouvre la préparation guidée du pilulier"
          />
        </Card>
      ) : null}
      {alerts && (alerts.stock.length > 0 || alerts.expirations.length > 0) ? (
        <Card style={styles.alerts}>
          <SectionTitle>À vérifier</SectionTitle>
          <Text style={styles.period}>
            Besoin calculé du {formatLongFrenchCivilDate(alerts.startDate)} au{' '}
            {formatLongFrenchCivilDate(alerts.endDate)}
          </Text>
          {alerts.stock.map((alert) => (
            <View key={alert.specialtyCis} style={styles.alertItem}>
              <Text style={styles.alertName}>{alert.specialtyName}</Text>
              <Badge
                label={
                  alert.status === 'INSUFFICIENT'
                    ? 'Stock insuffisant'
                    : 'Stock à surveiller'
                }
                tone={alert.status === 'INSUFFICIENT' ? 'danger' : 'warning'}
              />
              <Text>
                {formatHalfUnits(alert.usableStockHalfUnits)} disponible(s) pour{' '}
                {formatHalfUnits(alert.requiredHalfUnits)} nécessaire(s).
              </Text>
            </View>
          ))}
          {alerts.expirations.map((alert) => (
            <Link
              key={alert.boxId}
              href={{
                pathname: '/inventory/[id]',
                params: { id: String(alert.boxId) },
              }}
              style={styles.alertItem}
            >
              <Text style={styles.alertName}>{alert.specialtyName}</Text>
              <Text>
                Lot {alert.lot ?? 'non renseigné'} : péremption le{' '}
                {formatLongFrenchCivilDate(alert.expirationDate)}.
              </Text>
            </Link>
          ))}
          <Link href="/inventory" style={styles.alertLink}>
            Voir le stock
          </Link>
        </Card>
      ) : !loading && !error ? (
        <Message tone="success" title="Tout est prêt">
          Aucune alerte de stock ou de péremption pour le prochain pilulier.
        </Message>
      ) : null}
      <Card tone="muted">
        <SectionTitle>Cette semaine</SectionTitle>
        <Text style={typography.body}>
          {alerts
            ? `${alerts.stock.length} alerte${alerts.stock.length > 1 ? 's' : ''} de stock · ${alerts.expirations.length} péremption${alerts.expirations.length > 1 ? 's' : ''} à surveiller`
            : 'Résumé indisponible'}
        </Text>
      </Card>
      {lastPreparation ? (
        <LastPreparationCard
          detail={`Validée le ${formatDateTime(lastPreparation.completedAt)} · semaine du ${formatDate(lastPreparation.startDate)}`}
        />
      ) : null}
    </Screen>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function LastPreparationCard({ detail }: { detail: string }) {
  return (
    <Link href="/preparations/history" asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => pressed && styles.lastPreparationPressed}
      >
        <Card style={styles.lastPreparationCard}>
          <View style={styles.lastPreparationRow}>
            <View style={styles.homeLinkText}>
              <Badge label="Historique" tone="neutral" />
              <Text style={styles.homeLinkTitle}>Dernière préparation</Text>
              <Text style={styles.subtitle}>{detail}</Text>
            </View>
            <Text
              accessibilityElementsHidden
              maxFontSizeMultiplier={1.2}
              style={styles.chevron}
            >
              ›
            </Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  alertItem: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    gap: spacing.sm,
    marginTop: 8,
    padding: 10,
  },
  alertName: { fontWeight: '700' },
  alerts: {
    alignSelf: 'stretch',
    borderColor: colors.warning,
  },
  alertLink: {
    color: colors.brand,
    fontWeight: '700',
    minHeight: 44,
    paddingTop: spacing.md,
  },
  chevron: {
    color: colors.brand,
    flexShrink: 0,
    fontSize: 30,
    marginLeft: spacing.md,
  },
  hero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  preparationCard: {
    backgroundColor: colors.brand,
    borderColor: colors.brandPressed,
    gap: spacing.md,
    padding: spacing.xl,
  },
  preparationTitle: { ...typography.title, color: colors.surface },
  preparationBody: { ...typography.body, color: colors.surface },
  heroText: { flex: 1 },
  homeLinkText: { flex: 1, flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  homeLinkTitle: typography.label,
  lastPreparationCard: {
    borderColor: colors.borderStrong,
    minHeight: 112,
    width: '100%',
  },
  lastPreparationPressed: { opacity: 0.72 },
  lastPreparationRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  mark: { height: 48, width: 30 },
  markTop: {
    backgroundColor: colors.accent,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    height: 24,
  },
  markBottom: {
    backgroundColor: colors.brand,
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
    height: 24,
  },
  period: typography.caption,
  subtitle: typography.caption,
  title: typography.display,
});
