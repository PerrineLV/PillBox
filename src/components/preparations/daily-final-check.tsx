import { Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type { PreparationSnapshot } from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';

import { SLOT_LABELS } from './labels';
import { styles } from './styles';

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
          <Text style={styles.dayTitle}>{formatLongFrenchCivilDate(date)}</Text>
          {snapshot.items
            .filter((item) => item.date === date)
            .map((item, index) => (
              <Text
                key={`${item.slot}-${item.specialtyCis}-${index}`}
                style={styles.case}
              >
                • {SLOT_LABELS[item.slot]} · {item.specialtyName} :{' '}
                {formatHalfUnits(item.quantityHalfUnits)}
              </Text>
            ))}
          {snapshot.items.every((item) => item.date !== date) ? (
            <Text style={styles.case}>Aucune prise</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
