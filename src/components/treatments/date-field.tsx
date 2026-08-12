import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  civilDateToPickerDate,
  formatFrenchCivilDate,
  pickerDateToCivilDate,
} from './civil-date';

/** Sélecteur de date civile (JJ/MM/AAAA), avec repli texte sur le web. */
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const selectedDate = civilDateToPickerDate(value);

  function selectDate(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS !== 'ios') setPickerVisible(false);
    if (event.type === 'set' && date !== undefined)
      onChange(pickerDateToCivilDate(date));
  }

  if (Platform.OS === 'web')
    return (
      <View style={styles.dateField}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          accessibilityLabel={`${label} au format JJ/MM/AAAA`}
          placeholder="JJ/MM/AAAA"
          style={styles.dateInput}
          value={value === '' ? '' : formatFrenchCivilDate(value)}
          onChangeText={(text) => onChange(frenchInputToCivilDate(text))}
        />
      </View>
    );

  return (
    <View style={styles.dateField}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.dateActions}>
        <Pressable
          accessibilityLabel={`${label}, ${value === '' ? 'aucune date' : formatFrenchCivilDate(value)}`}
          accessibilityRole="button"
          onPress={() => setPickerVisible(true)}
          style={styles.dateButton}
        >
          <Text style={value === '' ? styles.datePlaceholder : undefined}>
            {value === '' ? 'Choisir une date' : formatFrenchCivilDate(value)}
          </Text>
        </Pressable>
        {value !== '' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange('')}
            style={styles.clearDate}
          >
            <Text style={styles.clearDateText}>Effacer</Text>
          </Pressable>
        ) : null}
      </View>
      {pickerVisible ? (
        <>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            locale="fr-FR"
            mode="date"
            onChange={selectDate}
            value={selectedDate ?? new Date()}
          />
          {Platform.OS === 'ios' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerVisible(false)}
              style={styles.closePicker}
            >
              <Text style={styles.secondaryButtonText}>
                Fermer le calendrier
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function frenchInputToCivilDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (match === null) return value;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

const styles = StyleSheet.create({
  clearDate: { paddingHorizontal: 8, paddingVertical: 12 },
  clearDateText: { color: '#b91c1c' },
  closePicker: { alignItems: 'center', padding: 10 },
  dateActions: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  dateButton: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  dateField: { gap: 4 },
  dateInput: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  datePlaceholder: { color: '#6b7280' },
  label: { fontWeight: '600', marginTop: 8 },
  secondaryButtonText: {
    color: '#1d4ed8',
    fontWeight: '700',
    textAlign: 'center',
  },
});
