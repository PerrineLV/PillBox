import { StyleSheet, Text, View } from 'react-native';

import type { GenericEquivalenceConfirmation } from '@/infrastructure/treatments/generic-equivalence-repository';
import { AppButton, Card, colors, spacing, typography } from '@/ui';
import { formatFrenchDateTime } from '@/components/treatments/civil-date';

/**
 * Équivalences génériques confirmées pour ce traitement : purement
 * consultatif et révocable. Oublier une entrée ne modifie aucune boîte,
 * mouvement de stock ou préparation déjà enregistrés ; elle redemande
 * seulement une confirmation à la prochaine vérification de ce CIS.
 */
export function GenericEquivalenceList({
  confirmations,
  onForget,
}: {
  confirmations: readonly GenericEquivalenceConfirmation[];
  onForget(cis: string): void;
}) {
  if (confirmations.length === 0) return null;

  return (
    <Card tone="muted" style={styles.card}>
      <Text style={styles.title}>Équivalences génériques mémorisées</Text>
      <Text style={styles.disclaimer}>
        Ces correspondances ont été confirmées explicitement lors d’une
        vérification de boîte. Les oublier ne modifie pas l’historique déjà
        enregistré ; la prochaine vérification de ce CIS redemandera une
        confirmation.
      </Text>
      {confirmations.map((confirmation) => (
        <View key={confirmation.cis} style={styles.row}>
          <Text style={styles.name}>{confirmation.specialtyName}</Text>
          <Text style={styles.detail}>
            CIS {confirmation.cis} · {confirmation.groupLabel}
          </Text>
          <Text style={styles.detail}>
            Confirmée le {formatFrenchDateTime(confirmation.confirmedAt)}
          </Text>
          <AppButton
            label="Oublier cette équivalence"
            variant="quiet"
            onPress={() => onForget(confirmation.cis)}
          />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.sm },
  detail: { color: colors.textMuted, fontSize: 13 },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  name: { fontWeight: '700' },
  row: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 2,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: { ...typography.heading, marginBottom: spacing.xs },
});
