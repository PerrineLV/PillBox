import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { todayIso } from '@/domain/inventory/inventory';
import {
  comparePrescriptionsForList,
  isPrescriptionValidityApproaching,
  type Prescription,
  type PrescriptionStatus,
} from '@/domain/prescriptions/prescription';
import { listPrescriptions } from '@/infrastructure/prescriptions/prescription-repository';
import {
  AppCard,
  AppScreen,
  EmptyState,
  LoadingState,
  Message,
  PillButton,
  ProgressBar,
  SeverityBadge,
  StackHeader,
  colors,
  radii,
  severity as severityScale,
  typography,
  type SeverityLevel,
} from '@/ui';

/** Fenêtre affichée par la barre de validité restante. */
const VALIDITY_WINDOW_DAYS = 365;

export default function PrescriptionsScreen() {
  const database = useSQLiteContext();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listPrescriptions(database, todayIso())
        .then((items) => {
          if (!active) return;
          setPrescriptions([...items].sort(comparePrescriptionsForList));
          setError(null);
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

  const activeCount = prescriptions.filter(
    (item) => item.status === 'ACTIVE',
  ).length;

  return (
    <AppScreen
      header={
        <StackHeader
          right={
            <PillButton
              height={38}
              label="Ajouter"
              onPress={() => router.push('/prescriptions/new')}
              tone="accent"
            />
          }
          subtitle={`${activeCount} active${activeCount > 1 ? 's' : ''}`}
          title="Ordonnances"
        />
      }
    >
      {loading ? <LoadingState label="Chargement des ordonnances…" /> : null}
      {error ? (
        <Message tone="error" title="Ordonnances indisponibles">
          {error}
        </Message>
      ) : null}
      {!loading && !error && prescriptions.length === 0 ? (
        <EmptyState
          description="Créez une ordonnance pour rattacher les traitements qu’elle couvre."
          title="Aucune ordonnance enregistrée"
        />
      ) : null}
      {prescriptions.map((prescription) => (
        <PrescriptionCard
          key={prescription.id}
          prescription={prescription}
          today={today}
        />
      ))}
    </AppScreen>
  );
}

function PrescriptionCard({
  prescription,
  today,
}: Readonly<{ prescription: Prescription; today: string }>) {
  const { label, level } = statusOf(prescription, today);
  const remaining = remainingDays(prescription.validUntil, today);
  return (
    <AppCard
      accessibilityLabel={`${prescription.label}, ${label}`}
      href={{
        pathname: '/prescriptions/[id]',
        params: { id: String(prescription.id) },
      }}
    >
      <View style={styles.head}>
        <View
          style={[styles.dot, { backgroundColor: severityScale[level].text }]}
        />
        <Text style={styles.name}>{prescription.label}</Text>
        <SeverityBadge label={label} level={level} />
      </View>
      {remaining !== null ? (
        <>
          <ProgressBar
            color={severityScale[level].text}
            ratio={remaining / VALIDITY_WINDOW_DAYS}
          />
          <Text style={styles.remaining}>
            {remaining > 0
              ? `${remaining} jour${remaining > 1 ? 's' : ''} de validité restants`
              : 'Validité dépassée'}
          </Text>
        </>
      ) : null}
      <Text style={typography.detail}>
        Émise le {formatLongFrenchCivilDate(prescription.issueDate)}
        {prescription.validUntil
          ? ` · valide jusqu’au ${formatLongFrenchCivilDate(prescription.validUntil)}`
          : ' · fin de validité non renseignée'}
      </Text>
    </AppCard>
  );
}

const STATUS_LABELS: Record<PrescriptionStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
  REPLACED: 'Remplacée',
};

function statusOf(
  prescription: Prescription,
  today: string,
): { label: string; level: SeverityLevel } {
  if (
    prescription.status === 'ACTIVE' &&
    isPrescriptionValidityApproaching(prescription, today)
  )
    return { label: 'Expire bientôt', level: 'warning' };
  return {
    label: STATUS_LABELS[prescription.status],
    level: prescription.status === 'ACTIVE' ? 'ok' : 'neutral',
  };
}

/** `null` lorsque la fin de validité n'est pas renseignée : rien n'est deviné. */
function remainingDays(
  validUntil: string | null,
  today: string,
): number | null {
  if (validUntil === null) return null;
  const end = Date.parse(`${validUntil}T12:00:00`);
  const start = Date.parse(`${today}T12:00:00`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const styles = StyleSheet.create({
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  dot: { borderRadius: radii.pill, height: 8, width: 8 },
  name: { ...typography.itemTitle, flex: 1, fontSize: 15.5, minWidth: 0 },
  remaining: {
    color: colors.textTertiary,
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 14,
  },
});
