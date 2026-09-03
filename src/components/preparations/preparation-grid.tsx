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
      accessibilityLabel={`Grille du pilulier : ${grid.preparedCases} cases remplies sur ${grid.totalCases}`}
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
              key={grid.days[dayIndex]}
              style={[styles.cell, cellStyles[cell]]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

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
  READY: { backgroundColor: colors.onDarkMuted },
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
  cell: { borderRadius: radii.cellLarge, flex: 1, height: 24 },
});
