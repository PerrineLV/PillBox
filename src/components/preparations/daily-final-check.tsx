import { Fragment } from 'react';
import { Text, View } from 'react-native';

import {
  formatFrenchDayAndMonth,
  formatFrenchWeekday,
} from '@/components/treatments/civil-date';
import type {
  PreparationItemSnapshot,
  PreparationSnapshot,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';

import { SLOT_LABELS } from './labels';
import { styles } from './styles';

export type DailySlotCheck = Readonly<{
  slot: PreparationItemSnapshot['slot'];
  quantityHalfUnits: number;
  items: readonly PreparationItemSnapshot[];
}>;

export function dailySlotChecks(
  items: readonly PreparationItemSnapshot[],
  date: string,
): readonly DailySlotCheck[] {
  const bySlot = new Map<
    PreparationItemSnapshot['slot'],
    { quantityHalfUnits: number; items: PreparationItemSnapshot[] }
  >();
  for (const item of items) {
    if (item.date !== date) continue;
    const check = bySlot.get(item.slot) ?? {
      quantityHalfUnits: 0,
      items: [],
    };
    check.quantityHalfUnits += item.quantityHalfUnits;
    check.items.push(item);
    bySlot.set(item.slot, check);
  }
  return [...bySlot].map(([slot, check]) => ({ slot, ...check }));
}

function tabletLabel(quantityHalfUnits: number): string {
  return quantityHalfUnits === 2 ? 'comprimé' : 'comprimés';
}

function slotLabel(slot: PreparationItemSnapshot['slot']): string {
  const label = SLOT_LABELS[slot];
  return `${label[0].toUpperCase()}${label.slice(1)}`;
}

export function DailyFinalCheck({
  snapshot,
}: {
  snapshot: PreparationSnapshot;
}) {
  const dates = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${snapshot.startDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
  return (
    <View style={styles.finalCheck}>
      {dates.map((date) => (
        <View key={date} style={styles.day}>
          <Text style={styles.dayTitle}>
            <Text style={styles.dayWeekday}>{formatFrenchWeekday(date)}</Text>{' '}
            <Text style={styles.dayDate}>{formatFrenchDayAndMonth(date)}</Text>
          </Text>
          {dailySlotChecks(snapshot.items, date).map((check) => (
            <Fragment key={check.slot}>
              <Text style={styles.slotTotal}>
                {slotLabel(check.slot)} :{' '}
                {formatHalfUnits(check.quantityHalfUnits)}{' '}
                {tabletLabel(check.quantityHalfUnits)}
              </Text>
              {check.items.map((item, index) => (
                <Text
                  key={`${check.slot}-${item.specialtyCis}-${index}`}
                  style={styles.case}
                >
                  • {item.specialtyName} :{' '}
                  {formatHalfUnits(item.quantityHalfUnits)}{' '}
                  {tabletLabel(item.quantityHalfUnits)}
                </Text>
              ))}
            </Fragment>
          ))}
          {dailySlotChecks(snapshot.items, date).length === 0 ? (
            <Text style={styles.case}>Aucune prise</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
