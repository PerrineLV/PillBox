import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>PillBox</Text>
      <Link href="/preparations/new" style={styles.primaryLink}>
        Préparer mon pilulier
      </Link>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Chargement des alertes" />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {alerts && (alerts.stock.length > 0 || alerts.expirations.length > 0) ? (
        <View style={styles.alerts}>
          <Text style={styles.alertsTitle}>
            À vérifier avant le prochain pilulier
          </Text>
          <Text style={styles.period}>
            Besoin calculé du {alerts.startDate} au {alerts.endDate}
          </Text>
          {alerts.stock.map((alert) => (
            <View key={alert.specialtyCis} style={styles.alertItem}>
              <Text style={styles.alertName}>{alert.specialtyName}</Text>
              <Text>
                {alert.status === 'INSUFFICIENT'
                  ? 'Stock insuffisant'
                  : 'Stock proche du besoin'}{' '}
                : {formatHalfUnits(alert.usableStockHalfUnits)} disponible(s)
                pour {formatHalfUnits(alert.requiredHalfUnits)} nécessaire(s).
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
        </View>
      ) : null}
      <Link href="/preparations/history" style={styles.link}>
        Historique des préparations
      </Link>
      <Link href="/treatments" style={styles.link}>
        Mes traitements
      </Link>
      <Link href="/inventory" style={styles.link}>
        Mon stock de boîtes
      </Link>
      <Link href="/medications/search" style={styles.link}>
        Rechercher un médicament
      </Link>
      <Link href="/settings" style={styles.link}>
        Réglages
      </Link>
      <Link href="/developer/datamatrix-scanner" style={styles.link}>
        Ouvrir le scanner DataMatrix (développeur)
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  alertItem: {
    backgroundColor: '#fff7ed',
    borderRadius: 6,
    marginTop: 8,
    padding: 10,
  },
  alertName: { fontWeight: '700' },
  alerts: {
    alignSelf: 'stretch',
    backgroundColor: '#fffbeb',
    borderColor: '#d97706',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    padding: 12,
  },
  alertsTitle: { color: '#92400e', fontSize: 17, fontWeight: '800' },
  container: {
    alignItems: 'center',
    backgroundColor: '#fff',
    flexGrow: 1,
    padding: 20,
  },
  error: { color: '#b91c1c', marginTop: 12 },
  link: { marginTop: 24 },
  period: { color: '#4b5563', marginTop: 4 },
  primaryLink: {
    backgroundColor: '#0F6F70',
    borderRadius: 8,
    color: '#fff',
    fontWeight: '700',
    marginTop: 24,
    overflow: 'hidden',
    padding: 14,
  },
  rule: { color: '#6b7280', fontSize: 12, marginTop: 10 },
  title: { fontSize: 32, fontWeight: '600' },
});
