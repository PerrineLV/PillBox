import { Link, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { todayIso } from '@/domain/inventory/inventory';
import {
  comparePrescriptionsForList,
  type Prescription,
  type PrescriptionStatus,
} from '@/domain/prescriptions/prescription';
import { listPrescriptions } from '@/infrastructure/prescriptions/prescription-repository';
import {
  Badge,
  EmptyState,
  LoadingState,
  Message,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';

const STATUS_LABELS: Record<PrescriptionStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
  REPLACED: 'Remplacée',
};

const STATUS_TONES: Record<
  PrescriptionStatus,
  'success' | 'neutral' | 'warning'
> = {
  ACTIVE: 'success',
  EXPIRED: 'neutral',
  REPLACED: 'neutral',
};

export default function PrescriptionsScreen() {
  const database = useSQLiteContext();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listPrescriptions(database, todayIso())
        .then((items) => {
          if (active) {
            setPrescriptions([...items].sort(comparePrescriptionsForList));
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Ordonnances' }} />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={typography.title}>
            Ordonnances
          </Text>
          <Text style={typography.caption}>
            {prescriptions.filter((item) => item.status === 'ACTIVE').length}{' '}
            active(s)
          </Text>
        </View>
        <Link href="/prescriptions/new" style={styles.add}>
          Ajouter
        </Link>
      </View>
      {loading ? <LoadingState label="Chargement des ordonnances…" /> : null}
      {error ? (
        <Message tone="error" title="Ordonnances indisponibles">
          {error}
        </Message>
      ) : null}
      <FlatList
        data={prescriptions}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          !loading && !error ? (
            <EmptyState
              title="Aucune ordonnance enregistrée"
              description="Créez une ordonnance pour rattacher les traitements qu’elle couvre."
            />
          ) : null
        }
        renderItem={({ item }) => <PrescriptionItemRow prescription={item} />}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

function PrescriptionItemRow({ prescription }: { prescription: Prescription }) {
  return (
    <Link
      href={{
        pathname: '/prescriptions/[id]',
        params: { id: String(prescription.id) },
      }}
      style={styles.item}
    >
      <View style={styles.itemContent}>
        <Text style={styles.name}>{prescription.label}</Text>
        <View style={styles.badges}>
          <Badge
            label={STATUS_LABELS[prescription.status]}
            tone={STATUS_TONES[prescription.status]}
          />
        </View>
        <Text style={styles.summary}>
          Émise le {formatLongFrenchCivilDate(prescription.issueDate)}
          {prescription.validUntil
            ? ` · Valide jusqu’au ${formatLongFrenchCivilDate(prescription.validUntil)}`
            : ' · Fin de validité non renseignée'}
        </Text>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  add: {
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    color: colors.surface,
    fontWeight: '700',
    minHeight: 48,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, gap: spacing.xs },
  item: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    minHeight: 88,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  itemContent: { gap: spacing.xs },
  list: { gap: spacing.md, paddingBottom: spacing.xxl },
  name: typography.heading,
  summary: { color: colors.textMuted, marginTop: spacing.xs },
});
