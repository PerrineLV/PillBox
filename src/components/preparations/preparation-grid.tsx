import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  formatFrenchWeekday,
  formatFrenchWeekdayAndDate,
} from '@/components/treatments/civil-date';
import type { WeeklyGrid, WeeklyGridCell } from '@/domain/home/weekly-grid';
import {
  INTAKE_SLOT_LABELS,
  colors,
  onDarkSurfaces,
  radii,
  sizes,
  spacing,
  typography,
} from '@/ui';

/**
 * Grille du pilulier sur fond sombre : sept colonnes de jours, une ligne par
 * créneau réellement servi. Elle se remplit médicament par médicament, à
 * mesure des étapes validées.
 */
export function PreparationGrid({ grid }: Readonly<{ grid: WeeklyGrid }>) {
  if (grid.slots.length === 0) return null;
  return (
    <View
      accessibilityLabel={`Grille du pilulier : ${grid.preparedCases} prises déposées sur ${grid.totalCases}`}
      style={styles.grid}
    >
      <Text style={styles.legendLabel}>
        → À remplir pour le médicament en cours
      </Text>
      <Text style={styles.legendLabel}>
        Faites défiler les jours horizontalement.
      </Text>
      <ScrollView horizontal>
        <View>
          <View style={styles.row}>
            <View style={styles.axis} />
            {grid.days.map((day) => (
              <Text key={day} style={styles.dayLabel}>
                {formatFrenchWeekday(day).slice(0, 3)}
                {'\n'}
                {day.slice(8, 10)}/{day.slice(5, 7)}
              </Text>
            ))}
          </View>
          {grid.rows.map((row, rowIndex) => (
            <View key={grid.slots[rowIndex]} style={styles.row}>
              <Text
                accessibilityLabel={INTAKE_SLOT_LABELS[grid.slots[rowIndex]]}
                style={styles.axisLabel}
              >
                {INTAKE_SLOT_LABELS[grid.slots[rowIndex]]}
              </Text>
              {row.map((cell, dayIndex) => (
                <View
                  accessible
                  accessibilityLabel={`${formatFrenchWeekdayAndDate(grid.days[dayIndex])}, ${INTAKE_SLOT_LABELS[grid.slots[rowIndex]]} : ${cellLabels[cell]}`}
                  key={grid.days[dayIndex]}
                  style={[styles.cell, cellStyles[cell]]}
                >
                  <Text style={[styles.cellSymbol, cellSymbolStyles[cell]]}>
                    {cellSymbols[cell]}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.legend}>
        {(['CURRENT', 'READY', 'TO_PREPARE', 'EMPTY'] as const).map((cell) => (
          <View key={cell} style={styles.legendItem}>
            <View style={[styles.legendCell, cellStyles[cell]]}>
              <Text style={[styles.legendSymbol, cellSymbolStyles[cell]]}>
                {cellSymbols[cell]}
              </Text>
            </View>
            <Text style={styles.legendLabel}>{cellLabels[cell]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const cellSymbols: Record<WeeklyGridCell, string> = {
  EMPTY: '—',
  TO_PREPARE: '…',
  CURRENT: '→',
  READY: '✓',
};

const cellLabels: Record<WeeklyGridCell, string> = {
  EMPTY: 'non concernée',
  TO_PREPARE: 'plus tard',
  CURRENT: 'à remplir maintenant',
  READY: 'remplie (tous les médicaments)',
};

const cellStyles: Record<WeeklyGridCell, object> = {
  EMPTY: {
    backgroundColor: colors.headerDark,
    borderColor: onDarkSurfaces.cellBorder,
    borderWidth: 1,
  },
  TO_PREPARE: {
    backgroundColor: colors.headerDark,
    borderColor: onDarkSurfaces.cellBorder,
    borderWidth: 1,
  },
  CURRENT: {
    backgroundColor: colors.accentOnDark,
    borderColor: colors.accentOnDark,
    borderWidth: 2,
  },
  READY: {
    backgroundColor: colors.headerDark,
    borderColor: colors.onDarkMuted,
    borderWidth: 1,
  },
};

const cellSymbolStyles: Record<WeeklyGridCell, object> = {
  EMPTY: { color: colors.onDarkSoft },
  TO_PREPARE: { color: colors.onDarkSoft },
  CURRENT: { color: colors.headerDark },
  READY: { color: colors.onDarkMuted },
};

const styles = StyleSheet.create({
  grid: {
    backgroundColor: colors.headerDark,
    borderColor: onDarkSurfaces.panelBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  axis: { width: sizes.minTouch * 2 },
  axisLabel: {
    ...typography.micro,
    color: colors.onDarkMuted,
    width: sizes.minTouch * 2,
  },
  dayLabel: {
    ...typography.micro,
    color: colors.onDarkSoft,
    width: sizes.minTouch + spacing.md,
    textAlign: 'center',
  },
  cell: {
    alignItems: 'center',
    borderRadius: radii.cellLarge,
    width: sizes.minTouch + spacing.md,
    minHeight: sizes.minTouch,
    justifyContent: 'center',
  },
  cellSymbol: { ...typography.itemTitle },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginLeft: 25,
    marginTop: 4,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 1,
  },
  legendCell: {
    alignItems: 'center',
    borderRadius: radii.cellLarge,
    minHeight: sizes.minTouch,
    minWidth: sizes.minTouch,
    justifyContent: 'center',
  },
  legendSymbol: { ...typography.itemTitle },
  legendLabel: { ...typography.micro, color: colors.onDarkSoft, flexShrink: 1 },
});
