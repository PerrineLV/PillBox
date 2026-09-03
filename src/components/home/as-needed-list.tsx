import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AsNeededRow } from '@/domain/home/as-needed-section';
import {
  ClockIcon,
  DenseList,
  DenseRow,
  PlusIcon,
  colors,
  radii,
  typography,
} from '@/ui';

/**
 * Traitements à prise ponctuelle, accessibles depuis l'accueil. Le corps de la
 * ligne mène à la fiche de prise ; seul le bouton rond enregistre, et il le
 * fait sur place.
 */
export function AsNeededList({
  rows,
  extraCount,
  busy,
  onRecord,
}: Readonly<{
  rows: readonly AsNeededRow[];
  /** Traitements « si besoin » au-delà du plafond d'affichage. */
  extraCount: number;
  busy: boolean;
  onRecord(row: AsNeededRow): void;
}>) {
  return (
    <DenseList>
      {rows.map((row, index) => (
        <DenseRow
          accessibilityLabel={`${row.specialtyName}. ${row.detail}`}
          detail={row.detail}
          first={index === 0}
          href={{
            pathname: '/intakes/as-needed/[id]',
            params: { id: String(row.treatmentId) },
          }}
          key={row.treatmentId}
          title={
            <Text style={[styles.name, row.blocked && styles.nameBlocked]}>
              {row.specialtyName}
            </Text>
          }
          trailing={
            <RecordButton busy={busy} onPress={() => onRecord(row)} row={row} />
          }
        />
      ))}
      {extraCount > 0 ? (
        <DenseRow
          chevron
          first={rows.length === 0}
          href={{ pathname: '/treatments', params: { filter: 'AS_NEEDED' } }}
          title={
            <Text style={styles.more}>
              {extraCount} autre{extraCount > 1 ? 's' : ''} traitement
              {extraCount > 1 ? 's' : ''} si besoin
            </Text>
          }
        />
      ) : null}
    </DenseList>
  );
}

function RecordButton({
  row,
  busy,
  onPress,
}: Readonly<{ row: AsNeededRow; busy: boolean; onPress(): void }>) {
  if (row.blocked) {
    return (
      <View
        accessibilityLabel={`Prise impossible pour ${row.specialtyName}. ${row.detail}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        style={[styles.button, styles.buttonBlocked]}
      >
        <ClockIcon color={colors.border} size={17} />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityHint="Enregistre une prise d’une unité, annulable juste après"
      accessibilityLabel={`Enregistrer une prise de ${row.specialtyName}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles.buttonAvailable,
        pressed && styles.buttonPressed,
      ]}
    >
      <PlusIcon color={colors.brandPressed} size={17} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.itemTitle, fontSize: 14.5 },
  nameBlocked: { color: colors.textTertiary },
  more: {
    color: colors.textMuted,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 17,
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  buttonAvailable: { backgroundColor: colors.brandSoft },
  buttonPressed: { backgroundColor: colors.brand },
  buttonBlocked: { borderColor: colors.hairline, borderWidth: 1.5 },
});
