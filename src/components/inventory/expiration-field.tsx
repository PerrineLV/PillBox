import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  civilDateToPickerDate,
  formatFrenchCivilDate,
  pickerDateToCivilDate,
} from '@/components/treatments/civil-date';
import { AppField, colors, radii, sizes } from '@/ui';

/**
 * Saisie d'une date de péremption. La valeur reste au format civil AAAA-MM-JJ
 * et demeure vide tant que l'utilisatrice n'a rien choisi : PillBox ne déduit
 * jamais une péremption absente de la boîte.
 */
export function ExpirationField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const [pickerVisible, setPickerVisible] = useState(false);

  function selectDate(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setPickerVisible(false);
    if (event.type === 'set' && date !== undefined)
      onChange(pickerDateToCivilDate(date));
  }

  if (Platform.OS === 'web')
    return (
      <AppField
        label={label}
        help="Format JJ/MM/AAAA"
        onChangeText={(text) => onChange(frenchInputToCivilDate(text))}
        placeholder="JJ/MM/AAAA"
        value={value === '' ? '' : formatFrenchCivilDate(value)}
      />
    );

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={`${label}, ${value === '' ? 'aucune date' : formatFrenchCivilDate(value)}`}
        accessibilityRole="button"
        onPress={() => setPickerVisible(true)}
        style={styles.button}
      >
        <Text style={value === '' ? styles.placeholder : styles.value}>
          {value === '' ? 'Choisir une date' : formatFrenchCivilDate(value)}
        </Text>
      </Pressable>
      {pickerVisible ? (
        <>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            locale="fr-FR"
            mode="date"
            onChange={selectDate}
            value={civilDateToPickerDate(value) ?? new Date()}
          />
          {Platform.OS === 'ios' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerVisible(false)}
              style={styles.close}
            >
              <Text style={styles.closeText}>Fermer le calendrier</Text>
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
  button: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.tile,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
  },
  close: { justifyContent: 'center', minHeight: sizes.minTouch },
  closeText: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  field: { gap: 6 },
  label: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  value: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: '600',
    lineHeight: 19,
  },
  placeholder: {
    color: colors.textTertiary,
    fontSize: 14.5,
    fontWeight: '500',
    lineHeight: 19,
  },
});
