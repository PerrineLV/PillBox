import { StyleSheet, Text, View } from 'react-native';

import { formatFrenchWeekday } from '@/components/treatments/civil-date';
import type { WeeklyGrid, WeeklyGridCell } from '@/domain/home/weekly-grid';
import {
  INTAKE_SLOT_INITIALS,
  INTAKE_SLOT_LABELS,
  colors,
  onDarkSurfaces,
  radii,
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
      <View style={styles.row}>
        <View style={styles.axis} />
        {grid.days.map((day) => (
          <Text key={day} style={styles.dayLabel}>
            {formatFrenchWeekday(day).charAt(0)}
          </Text>
        ))}
      </View>
      {grid.rows.map((row, rowIndex) => (
        <View key={grid.slots[rowIndex]} style={styles.row}>
          <Text
            accessibilityLabel={INTAKE_SLOT_LABELS[grid.slots[rowIndex]]}
            style={styles.axisLabel}
          >
            {INTAKE_SLOT_INITIALS[grid.slots[rowIndex]]}
          </Text>
          {row.map((cell, dayIndex) => (
            <View
              accessibilityLabel={`${formatFrenchWeekday(grid.days[dayIndex])}, ${INTAKE_SLOT_LABELS[grid.slots[rowIndex]]} : ${cellLabels[cell]}`}
              key={grid.days[dayIndex]}
              style={[styles.cell, cellStyles[cell]]}
            >
              {cell === 'EMPTY' ? null : (
                <Text style={[styles.cellSymbol, cellSymbolStyles[cell]]}>
                  {cellSymbols[cell]}
                </Text>
              )}
            </View>
          ))}
        </View>
      ))}
      <View style={styles.legend}>
        {(['CURRENT', 'READY', 'TO_PREPARE'] as const).map((cell) => (
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

const cellSymbols: Record<Exclude<WeeklyGridCell, 'EMPTY'>, string> = {
  TO_PREPARE: '·',
  CURRENT: '→',
  READY: '✓',
};

const cellLabels: Record<WeeklyGridCell, string> = {
  EMPTY: 'aucune prise',
  TO_PREPARE: 'plus tard',
  CURRENT: 'à remplir maintenant',
  READY: 'complète',
};

const cellStyles: Record<WeeklyGridCell, object> = {
  EMPTY: {
    backgroundColor: onDarkSurfaces.cell,
    borderColor: onDarkSurfaces.cellBorder,
    borderWidth: 1,
    opacity: 0.45,
  },
  TO_PREPARE: {
    backgroundColor: onDarkSurfaces.cell,
    borderColor: onDarkSurfaces.cellBorder,
    borderWidth: 1,
  },
  CURRENT: {
    backgroundColor: onDarkSurfaces.control,
    borderColor: colors.accentOnDark,
    borderWidth: 2,
  },
  READY: { backgroundColor: colors.onDarkMuted },
};

const cellSymbolStyles: Record<Exclude<WeeklyGridCell, 'EMPTY'>, object> = {
  TO_PREPARE: { color: colors.onDarkSoft },
  CURRENT: { color: colors.accentOnDark },
  READY: { color: colors.headerDark },
};

const styles = StyleSheet.create({
  grid: {
    backgroundColor: onDarkSurfaces.panel,
    borderColor: onDarkSurfaces.panelBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  axis: { width: 20 },
  axisLabel: {
    color: colors.onDarkMuted,
    fontSize: 9.5,
    fontWeight: '800',
    lineHeight: 12,
    textAlign: 'center',
    width: 20,
  },
  dayLabel: {
    color: colors.onDarkSoft,
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
    textAlign: 'center',
  },
  cell: {
    alignItems: 'center',
    borderRadius: radii.cellLarge,
    flex: 1,
    height: 24,
    justifyContent: 'center',
  },
  cellSymbol: { fontSize: 14, fontWeight: '900', lineHeight: 17 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginLeft: 25,
    marginTop: 4,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  legendCell: {
    alignItems: 'center',
    borderRadius: 4,
    height: 15,
    justifyContent: 'center',
    width: 20,
  },
  legendSymbol: { fontSize: 10, fontWeight: '900', lineHeight: 12 },
  legendLabel: {
    color: colors.onDarkSoft,
    fontSize: 8.5,
    fontWeight: '600',
    lineHeight: 11,
  },
});
