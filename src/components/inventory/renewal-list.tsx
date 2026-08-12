import { StyleSheet, Text, View } from 'react-native';

import {
  renewalAvailabilityLabel,
  renewalRuptureLabel,
  renewalTheoreticalRenewalLabel,
  renewalUrgencyTone,
} from './renewal-labels';
import type { RenewalItem } from '@/domain/renewal/renewal-list';
import {
  Badge,
  Card,
  EmptyState,
  RENEWAL_URGENCY_LABELS,
  spacing,
  typography,
} from '@/ui';

export function RenewalList({
  items,
}: Readonly<{
  items: readonly RenewalItem[];
}>) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Rien à renouveler"
        description="Aucun médicament ne nécessite d’action selon la prévision de stock."
      />
    );
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <Card key={item.specialtyCis} style={styles.card}>
          <Text style={typography.heading}>{item.specialtyName}</Text>
          <Badge
            label={RENEWAL_URGENCY_LABELS[item.urgency]}
            tone={renewalUrgencyTone(item.urgency)}
          />
          <Text style={typography.body}>{renewalAvailabilityLabel(item)}</Text>
          {renewalRuptureLabel(item) !== null ? (
            <Text style={typography.caption}>{renewalRuptureLabel(item)}</Text>
          ) : null}
          {renewalTheoreticalRenewalLabel(item) !== null ? (
            <Text style={typography.caption}>
              {renewalTheoreticalRenewalLabel(item)}
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  list: { gap: spacing.md },
});
