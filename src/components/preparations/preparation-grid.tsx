import { StyleSheet, Text, View } from 'react-native';

import {
  formatFrenchWeekday,
  formatFrenchWeekdayAndDate,
} from '@/components/treatments/civil-date';
import {
  buildMedicationFillingCells,
  type BoxFillingContribution,
} from '@/domain/preparations/box-filling-guide';
import type { PreparationItemSnapshot } from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import type { WeeklyGrid, WeeklyGridCell } from '@/domain/home/weekly-grid';
import {
  INTAKE_SLOT_LABELS,
  colors,
  onDarkSurfaces,
  radii,
  preparationGridLayout,
  spacing,
  typography,
} from '@/ui';

/**
 * Grille du pilulier sur fond sombre : sept colonnes de jours, une ligne par
 * créneau réellement servi. Elle se remplit médicament par médicament, à
 * mesure des étapes validées.
 */
export function PreparationGrid({
  grid,
  currentMedication,
}: Readonly<{
  grid: WeeklyGrid;
  currentMedication?: Readonly<{
    name: string;
    items: readonly PreparationItemSnapshot[];
    contributions: readonly BoxFillingContribution[];
  }>;
}>) {
  const quantities = currentMedication
    ? buildMedicationFillingCells(
        currentMedication.items,
        currentMedication.contributions,
      )
    : [];
  if (grid.slots.length === 0) return null;
  return (
    <View
      accessibilityLabel={`Grille du pilulier : ${grid.preparedCases} prises déposées sur ${grid.totalCases}`}
      style={styles.grid}
    >
      {currentMedication ? (
        <Text style={styles.legendLabel}>{currentMedication.name}</Text>
      ) : null}
      <View style={styles.rows}>
        <View style={styles.row}>
          <View style={styles.axis} />
          {grid.days.map((day) => (
            <Text key={day} style={styles.dayLabel}>
              {formatFrenchWeekday(day).slice(0, 2)}
              {'\n'}
              {day.slice(8, 10)}
            </Text>
          ))}
        </View>
        {grid.rows.map((row, rowIndex) => (
          <View key={grid.slots[rowIndex]} style={styles.row}>
            <Text
              accessibilityLabel={INTAKE_SLOT_LABELS[grid.slots[rowIndex]]}
              style={styles.axisLabel}
            >
              {slotShortLabels[grid.slots[rowIndex]]}
            </Text>
            {row.map((cell, dayIndex) => {
              const quantity = quantities.find(
                (item) =>
                  item.date === grid.days[dayIndex] &&
                  item.slot === grid.slots[rowIndex],
              );
              const state = currentMedication
                ? quantity
                  ? quantity.remainingHalfUnits > 0
                    ? 'CURRENT'
                    : 'READY'
                  : 'EMPTY'
                : cell;
              const symbol = currentMedication
                ? quantity
                  ? quantity.remainingHalfUnits > 0
                    ? compactQuantity(quantity.remainingHalfUnits)
                    : '✓'
                  : ''
                : cellSymbols[cell];
              const label = currentMedication
                ? quantity
                  ? quantity.remainingHalfUnits > 0
                    ? `${formatHalfUnits(quantity.remainingHalfUnits)} à déposer${quantity.depositedHalfUnits > 0 ? `, ${formatHalfUnits(quantity.depositedHalfUnits)} déjà déposé` : ''} pour ${currentMedication.name}`
                    : `déjà déposé pour ${currentMedication.name}`
                  : `aucune prise de ${currentMedication.name}`
                : cellLabels[cell];
              return (
                <View
                  accessible
                  accessibilityLabel={`${formatFrenchWeekdayAndDate(grid.days[dayIndex])}, ${INTAKE_SLOT_LABELS[grid.slots[rowIndex]]} : ${label}`}
                  key={grid.days[dayIndex]}
                  style={[styles.cell, cellStyles[state]]}
                >
                  <Text style={[styles.cellSymbol, cellSymbolStyles[state]]}>
                    {symbol}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {currentMedication ? (
        <Text style={styles.legendLabel}>
          Quantité à déposer · ✓ déjà déposé
        </Text>
      ) : (
        <View
          style={styles.legend}
          accessibilityLabel="À remplir : médicament en cours. Complète : tous les médicaments déposés. Plus tard : reste à préparer. Vide : aucune prise prévue."
        >
          {(['CURRENT', 'READY', 'TO_PREPARE', 'EMPTY'] as const).map(
            (cell) => (
              <View key={cell} style={styles.legendItem}>
                <Text
                  style={[
                    styles.legendSymbol,
                    cell === 'CURRENT'
                      ? styles.currentLegendSymbol
                      : cellSymbolStyles[cell],
                  ]}
                >
                  {cellSymbols[cell]}
                </Text>
                <Text style={styles.legendLabel}>{shortCellLabels[cell]}</Text>
              </View>
            ),
          )}
        </View>
      )}
    </View>
  );
}

function compactQuantity(halfUnits: number): string {
  if (halfUnits % 2 === 0) return String(halfUnits / 2);
  return `${halfUnits > 1 ? Math.floor(halfUnits / 2) : ''}½`;
}

const slotShortLabels = {
  morning: 'Mat.',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Couch.',
} as const;
const shortCellLabels: Record<WeeklyGridCell, string> = {
  CURRENT: 'À remplir',
  READY: 'Complète',
  TO_PREPARE: 'Plus tard',
  EMPTY: 'Vide',
};

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
    gap: preparationGridLayout.gap,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rows: { gap: preparationGridLayout.gap },
  currentLegendSymbol: { color: colors.accentOnDark },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: preparationGridLayout.gap,
  },
  axis: { width: preparationGridLayout.axisWidth },
  axisLabel: {
    ...typography.micro,
    color: colors.onDarkMuted,
    width: preparationGridLayout.axisWidth,
  },
  dayLabel: {
    ...typography.micro,
    color: colors.onDarkSoft,
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  cell: {
    alignItems: 'center',
    borderRadius: radii.cellLarge,
    flex: 1,
    minWidth: 0,
    minHeight: preparationGridLayout.cellHeight,
    justifyContent: 'center',
  },
  cellSymbol: { ...typography.itemTitle },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: preparationGridLayout.gap,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 1,
  },
  legendSymbol: { ...typography.micro },
  legendLabel: { ...typography.micro, color: colors.onDarkSoft, flexShrink: 1 },
});
