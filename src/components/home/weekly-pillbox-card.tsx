import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  formatFrenchDayAndMonth,
  formatFrenchWeekday,
} from '@/components/treatments/civil-date';
import type { WeeklyGrid, WeeklyGridCell } from '@/domain/home/weekly-grid';
import { colors, layout, radii, typography } from '@/ui';

/**
 * Une semaine déjà préparée n'a pas d'état ici : la carte disparaît alors de
 * l'accueil, faute de quoi que ce soit à faire.
 */
export type WeeklyPreparationState = 'TO_PREPARE' | 'IN_PROGRESS';

const ACTIONS: Record<WeeklyPreparationState, { label: string; href: Href }> = {
  TO_PREPARE: { label: 'Préparer', href: '/preparations/new' },
  IN_PROGRESS: { label: 'Reprendre', href: '/preparations/new' },
};

/** Résumé de la semaine : la grille du pilulier, à l'échelle de l'accueil. */
export function WeeklyPillboxCard({
  grid,
  state,
}: Readonly<{ grid: WeeklyGrid; state: WeeklyPreparationState }>) {
  const action = ACTIONS[state];
  const status =
    state === 'IN_PROGRESS'
      ? `${grid.preparedCases} / ${grid.totalCases} cases`
      : 'À préparer';
  return (
    <Pressable
      accessibilityLabel={`Pilulier de la semaine du ${formatFrenchDayAndMonth(grid.startDate)}, ${status}. ${action.label}`}
      accessibilityRole="button"
      onPress={() => router.navigate(action.href)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View accessibilityElementsHidden style={styles.grid}>
        <View style={styles.gridRow}>
          {grid.days.map((day) => (
            <Text key={day} style={styles.dayLabel}>
              {formatFrenchWeekday(day).charAt(0)}
            </Text>
          ))}
        </View>
        {grid.rows.map((row, rowIndex) => (
          <View key={grid.slots[rowIndex]} style={styles.gridRow}>
            {row.map((cell, dayIndex) => (
              <View
                key={grid.days[dayIndex]}
                style={[styles.cell, cellStyles[cell]]}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.footer}>
        <View style={styles.footerText}>
          <Text style={styles.week}>
            Semaine du {formatFrenchDayAndMonth(grid.startDate)}
          </Text>
          <Text style={styles.status}>{status}</Text>
        </View>
        <Text style={styles.action}>{action.label}</Text>
      </View>
    </Pressable>
  );
}

const cellStyles: Record<WeeklyGridCell, { backgroundColor: string }> = {
  EMPTY: { backgroundColor: colors.hairline },
  TO_PREPARE: { backgroundColor: colors.gridPending },
  READY: { backgroundColor: colors.gridReady },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 12,
    padding: layout.screenPadding - 4,
  },
  cardPressed: { borderColor: colors.gridPending },
  grid: { gap: 5 },
  gridRow: { flexDirection: 'row', gap: 5 },
  dayLabel: {
    color: colors.textTertiary,
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
    textAlign: 'center',
  },
  cell: { borderRadius: radii.cell, flex: 1, height: 9 },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  footerText: { flex: 1, gap: 3, minWidth: 0 },
  week: { ...typography.detail },
  status: {
    ...typography.numeric,
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 17,
  },
  action: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
});
