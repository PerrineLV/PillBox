import { StyleSheet, Text, View } from 'react-native';

import {
  renewalAvailabilityLabel,
  renewalRunsOutBeforeWindowLabel,
  renewalRuptureLabel,
  renewalTheoreticalRenewalLabel,
} from './renewal-labels';
import type {
  RenewalItem,
  RenewalUrgency,
} from '@/domain/renewal/renewal-list';
import {
  AppCard,
  EmptyState,
  RENEWAL_URGENCY_LABELS,
  SeverityBadge,
  colors,
  typography,
  type SeverityLevel,
} from '@/ui';

/** Gravité affichée pour une urgence de renouvellement, selon l'échelle commune. */
export function renewalSeverity(urgency: RenewalUrgency): SeverityLevel {
  if (urgency === 'INSUFFICIENT_FOR_NEXT_PREPARATION') return 'high';
  if (urgency === 'RUNS_OUT_SOON') return 'warning';
  return 'neutral';
}

export function RenewalList({
  items,
}: Readonly<{
  items: readonly RenewalItem[];
}>) {
  if (items.length === 0) {
    return (
      <EmptyState
        description="Aucun médicament ne nécessite d’action selon la prévision de stock."
        title="Rien à renouveler"
      />
    );
  }
  return (
    <View style={styles.list}>
      {items.map((item) => {
        const level = renewalSeverity(item.urgency);
        const rupture = renewalRuptureLabel(item);
        const window = renewalTheoreticalRenewalLabel(item);
        const blocked = renewalRunsOutBeforeWindowLabel(item);
        return (
          <AppCard key={item.specialtyCis}>
            <View style={styles.head}>
              <Text style={styles.name}>{item.specialtyName}</Text>
              <SeverityBadge
                label={RENEWAL_URGENCY_LABELS[item.urgency]}
                level={level}
              />
            </View>
            <Text style={typography.detail}>
              {renewalAvailabilityLabel(item)}
            </Text>
            {rupture !== null ? (
              <Text style={typography.micro}>{rupture}</Text>
            ) : null}
            {window !== null ? (
              <Text style={typography.micro}>{window}</Text>
            ) : null}
            {blocked !== null ? (
              <Text style={styles.blocked}>{blocked}</Text>
            ) : null}
          </AppCard>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  head: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  name: { ...typography.itemTitle, flex: 1, fontSize: 15.5, minWidth: 0 },
  blocked: {
    ...typography.micro,
    color: colors.destructive,
    fontWeight: '700',
  },
});
