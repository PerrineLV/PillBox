import { Link, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isExpired,
  todayIso,
  usableQuantity,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  Badge,
  Card,
  EmptyState,
  LoadingState,
  Message,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

export default function InventoryScreen() {
  const database = useSQLiteContext();
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listMedicationBoxes(database)
        .then((items) => {
          if (active) {
            setBoxes(items);
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

  const groups = useMemo(() => groupBoxes(boxes), [boxes]);
  const today = todayIso();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Mon stock' }} />
      <Link href="/inventory/new" style={styles.add}>
        Scanner une boîte
      </Link>
      {loading ? <LoadingState label="Chargement du stock…" /> : null}
      {error ? (
        <Message tone="error" title="Stock indisponible">
          {error}
        </Message>
      ) : null}
      {!loading && !error && groups.length === 0 ? (
        <EmptyState
          title="Aucune boîte enregistrée"
          description="Scannez le DataMatrix d’une boîte pour suivre son lot, sa péremption et sa quantité."
        />
      ) : null}
      {groups.map((medication) => (
        <View key={medication.cis} style={styles.medication}>
          <Text style={styles.medicationName}>{medication.name}</Text>
          {medication.lots.map((lot) => {
            const usable = lot.boxes.reduce(
              (sum, box) => sum + usableQuantity(box, today),
              0,
            );
            return (
              <Card key={lot.key} style={styles.lot}>
                <Text style={styles.lotTitle}>Lot {lot.label}</Text>
                <Text style={styles.usable}>Stock utilisable : {usable}</Text>
                {lot.boxes.map((box) => {
                  const expired = isExpired(box.expirationDate, today);
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
                        <Text>Péremption : {box.expirationDate}</Text>
                        {box.serialNumber ? (
                          <Text>Numéro de série : {box.serialNumber}</Text>
                        ) : null}
                        {expired ? (
                          <Badge
                            label="Périmée — stock inutilisable"
                            tone="danger"
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
      ))}
    </ScrollView>
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
    color: '#fff',
    fontWeight: '700',
    marginBottom: 16,
    overflow: 'hidden',
    padding: 14,
    textAlign: 'center',
  },
  box: { borderTopColor: '#d1d5db', borderTopWidth: 1, paddingVertical: 12 },
  boxTitle: { fontWeight: '700' },
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
  },
  empty: { color: '#4b5563', paddingTop: 30, textAlign: 'center' },
  error: { color: '#b91c1c' },
  expired: { color: '#b91c1c', fontWeight: '800', marginTop: 5 },
  expiredBox: { backgroundColor: '#fff1f2' },
  lot: {
    borderColor: '#d1d5db',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  lotTitle: { fontSize: 16, fontWeight: '700' },
  medication: { marginBottom: 24 },
  medicationName: typography.heading,
  usable: { color: colors.brand, fontWeight: '700', marginBottom: 4 },
});
