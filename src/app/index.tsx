import { Link, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildInventoryAlerts,
  EXPIRATION_WARNING_DAYS,
  LOW_STOCK_MARGIN_PERCENT,
  type InventoryAlerts,
} from '@/domain/alerts/inventory-alerts';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import { todayIso } from '@/domain/inventory/inventory';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([listTreatments(database), listMedicationBoxes(database)])
        .then(([treatments, boxes]) => {
          if (!active) return;
          setAlerts(buildInventoryAlerts(treatments, boxes, todayIso()));
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

  return <HomeContent alerts={alerts} loading={loading} error={error} />;
}

export function HomeContent({
  alerts,
  loading,
  error,
}: Readonly<{
  alerts: InventoryAlerts | null;
  loading: boolean;
  error: string | null;
}>) {
  return (
    <Screen
      fixedHeader={
        <>
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
          <AppButton
            label="Préparer mon pilulier"
            onPress={() => router.push('/preparations/new')}
            accessibilityHint="Commence ou reprend la préparation de la semaine"
          />
        </>
      }
    >
      {loading ? <LoadingState label="Chargement de votre situation…" /> : null}
      {error ? (
        <Message tone="error" title="Alertes indisponibles">
          {error}
        </Message>
      ) : null}
      {alerts && (alerts.stock.length > 0 || alerts.expirations.length > 0) ? (
        <Card style={styles.alerts}>
          <SectionTitle>À vérifier avant le prochain pilulier</SectionTitle>
          <Text style={styles.period}>
            Besoin calculé du {alerts.startDate} au {alerts.endDate}
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
                {alert.expirationDate}.
              </Text>
            </Link>
          ))}
          <Text style={styles.rule}>
            Stock proche : au plus {LOW_STOCK_MARGIN_PERCENT} % au-dessus du
            besoin. Péremption proche : dans les {EXPIRATION_WARNING_DAYS}{' '}
            jours. Les boîtes périmées sont exclues.
          </Text>
        </Card>
      ) : !loading && !error ? (
        <Message tone="success" title="Tout est prêt">
          Aucune alerte de stock ou de péremption pour le prochain pilulier.
        </Message>
      ) : null}
      <SectionTitle>Gérer</SectionTitle>
      <View style={styles.actions}>
        <HomeLink
          href="/treatments"
          title="Mes traitements"
          detail="Posologies et inclusion dans le pilulier"
        />
        <HomeLink
          href="/inventory"
          title="Mon stock"
          detail="Boîtes, lots, péremptions et quantités"
        />
        <HomeLink
          href="/preparations/history"
          title="Historique"
          detail="Préparations validées et lots utilisés"
        />
        <HomeLink
          href="/intakes/history"
          title="Historique des prises"
          detail="Prises, reports et corrections enregistrés localement"
        />
        <HomeLink
          href="/settings"
          title="Réglages"
          detail="Rappel, sauvegarde et restauration"
        />
      </View>
    </Screen>
  );
}

function HomeLink({
  href,
  title,
  detail,
}: {
  href:
    | '/treatments'
    | '/inventory'
    | '/preparations/history'
    | '/intakes/history'
    | '/settings';
  title: string;
  detail: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.homeLink,
          pressed && styles.homeLinkPressed,
        ]}
      >
        <View style={styles.homeLinkText}>
          <Text style={styles.homeLinkTitle}>{title}</Text>
          <Text style={styles.subtitle}>{detail}</Text>
        </View>
        <Text accessibilityElementsHidden style={styles.chevron}>
          ›
        </Text>
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
  alertsTitle: { color: '#92400e', fontSize: 17, fontWeight: '800' },
  actions: { gap: spacing.sm },
  chevron: { color: colors.brand, fontSize: 30 },
  hero: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  heroText: { flex: 1 },
  homeLink: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 72,
    padding: spacing.md,
  },
  homeLinkPressed: { backgroundColor: colors.brandSoft },
  homeLinkText: { flex: 1, gap: 2 },
  homeLinkTitle: typography.label,
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
  rule: typography.caption,
  subtitle: typography.caption,
  title: typography.display,
});
