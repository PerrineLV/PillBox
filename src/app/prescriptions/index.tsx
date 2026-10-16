import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrescriptionArchiveAction } from '@/components/prescriptions/prescription-archive-action';
import { usePrescriptionToday } from '@/components/prescriptions/use-prescription-today';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import {
  partitionPrescriptions,
  prescriptionHistoryLabel,
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
  const today = usePrescriptionToday();
  const [expanded, setExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listPrescriptions(database, today)
        .then((items) => {
          if (!active) return;
          setPrescriptions(items);
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
    }, [database, today]),
  );

  const { active, past } = partitionPrescriptions(prescriptions, today);
  const activeCount = active.length;
  const card = (prescription: Prescription) => (
    <View key={prescription.id} style={{ gap: 8 }}>
      <PrescriptionCard prescription={prescription} today={today} />
      <PrescriptionArchiveAction
        prescription={prescription}
        onChanged={() =>
          setPrescriptions((current) =>
            current.map((item) =>
              item.id === prescription.id
                ? { ...item, archived: !prescription.archived }
                : item,
            ),
          )
        }
      />
    </View>
  );

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
      {!loading && !error ? (
        <>
          {prescriptions.length > 0 && active.length === 0 ? (
            <EmptyState
              title="Aucune ordonnance active"
              description="Vos ordonnances restent consultables dans la section ci-dessous."
            />
          ) : null}
          {active.map(card)}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((value) => !value)}
            style={styles.historyToggle}
          >
            <Text style={typography.sectionLabel}>
              Ordonnances expirées et archivées ({past.length})
            </Text>
            <Text style={typography.detail}>
              {expanded ? 'Replier' : 'Déplier'}
            </Text>
          </Pressable>
          {expanded ? (
            past.length === 0 ? (
              <EmptyState
                title="Aucune ordonnance expirée ou archivée"
                description="Les ordonnances expirées ou archivées apparaîtront ici."
              />
            ) : (
              past.map(card)
            )
          ) : null}
        </>
      ) : null}
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
              : prescription.validUntil === today
                ? 'Valide jusqu’à aujourd’hui inclus'
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
  const historyLabel = prescriptionHistoryLabel(prescription, today);
  if (historyLabel) return { label: historyLabel, level: 'neutral' };
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
  historyToggle: { paddingVertical: 14, gap: 6 },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
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
