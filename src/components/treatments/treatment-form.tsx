import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  INTAKE_SLOTS,
  WEEKDAYS,
  type Dosage,
  type IntakeSlot,
  type TreatmentDraft,
  type Weekday,
} from '@/domain/treatments/treatment';

const DAY_LABELS: Record<Weekday, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mer',
  thursday: 'Jeu',
  friday: 'Ven',
  saturday: 'Sam',
  sunday: 'Dim',
};
const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};

type Props = {
  initialValue: TreatmentDraft;
  submitLabel: string;
  onSubmit: (value: TreatmentDraft) => Promise<void>;
};

export function TreatmentForm({ initialValue, submitLabel, onSubmit }: Props) {
  const [days, setDays] = useState<Weekday[]>(() =>
    uniqueDays(initialValue.dosage),
  );
  const [quantities, setQuantities] = useState<Record<IntakeSlot, string>>(() =>
    initialQuantities(initialValue.dosage),
  );
  const [active, setActive] = useState(initialValue.active);
  const [included, setIncluded] = useState(initialValue.includedInPillbox);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dosage = useMemo(
    () => buildDosage(days, quantities),
    [days, quantities],
  );

  async function submit() {
    if (days.length === 0) return setError('Sélectionnez au moins un jour.');
    if (hasInvalidQuantity(quantities))
      return setError(
        'Chaque quantité doit être un multiple positif de 0,5. Laissez un créneau vide s’il n’y a pas de prise.',
      );
    if (dosage.length === 0)
      return setError('Saisissez une quantité pour au moins un créneau.');
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        ...initialValue,
        active,
        includedInPillbox: included,
        dosage,
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.name}>{initialValue.specialtyName}</Text>
      <Text>CIS {initialValue.specialtyCis}</Text>
      {initialValue.pharmaceuticalForm ? (
        <Text>{initialValue.pharmaceuticalForm}</Text>
      ) : null}
      <Text style={styles.warning}>
        La posologie ci-dessous est saisie par vous. Elle n’est pas déduite du
        médicament.
      </Text>
      <Text style={styles.heading}>Jours de prise</Text>
      <View style={styles.row}>
        {WEEKDAYS.map((day) => (
          <Choice
            key={day}
            label={DAY_LABELS[day]}
            selected={days.includes(day)}
            onPress={() => setDays(toggle(days, day))}
          />
        ))}
      </View>
      <Text style={styles.heading}>Quantité par créneau</Text>
      {INTAKE_SLOTS.map((slot) => (
        <View key={slot} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{SLOT_LABELS[slot]}</Text>
          <TextInput
            accessibilityLabel={`Quantité ${SLOT_LABELS[slot]}`}
            inputMode="decimal"
            placeholder="0"
            style={styles.input}
            value={quantities[slot]}
            onChangeText={(value) =>
              setQuantities({ ...quantities, [slot]: value })
            }
          />
        </View>
      ))}
      <Text style={styles.hint}>
        Quantités acceptées : multiples de 0,5 (par exemple 0,5 ; 1 ; 1,5).
      </Text>
      <Toggle label="Traitement actif" value={active} onChange={setActive} />
      <Toggle
        label="Inclure dans le pilulier"
        value={included}
        onChange={setIncluded}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={submit}
        style={styles.submit}
      >
        <Text style={styles.submitText}>
          {saving ? 'Enregistrement…' : submitLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function buildDosage(
  days: readonly Weekday[],
  values: Record<IntakeSlot, string>,
): Dosage[] {
  const result: Dosage[] = [];
  for (const day of days)
    for (const slot of INTAKE_SLOTS) {
      const normalized = values[slot].trim().replace(',', '.');
      if (normalized === '') continue;
      const quantity = Number(normalized);
      const halfUnits = quantity * 2;
      if (!Number.isSafeInteger(halfUnits) || halfUnits <= 0) continue;
      result.push({ weekday: day, slot, quantityHalfUnits: halfUnits });
    }
  return result;
}

function hasInvalidQuantity(values: Record<IntakeSlot, string>): boolean {
  return INTAKE_SLOTS.some((slot) => {
    const normalized = values[slot].trim().replace(',', '.');
    if (normalized === '') return false;
    const halfUnits = Number(normalized) * 2;
    return !Number.isSafeInteger(halfUnits) || halfUnits <= 0;
  });
}

function initialQuantities(
  dosage: readonly Dosage[],
): Record<IntakeSlot, string> {
  const result = { morning: '', noon: '', evening: '', bedtime: '' };
  for (const slot of INTAKE_SLOTS) {
    const values = dosage
      .filter((item) => item.slot === slot)
      .map((item) => item.quantityHalfUnits);
    if (values.length > 0 && values.every((value) => value === values[0]))
      result[slot] = String(values[0] / 2).replace('.', ',');
  }
  return result;
}
function uniqueDays(dosage: readonly Dosage[]): Weekday[] {
  return WEEKDAYS.filter((day) => dosage.some((item) => item.weekday === day));
}
function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}
function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Text>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  choiceSelected: { backgroundColor: '#bfdbfe', borderColor: '#2563eb' },
  error: { color: '#b91c1c' },
  fieldLabel: { flex: 1 },
  fieldRow: { alignItems: 'center', flexDirection: 'row', marginBottom: 8 },
  form: { gap: 8 },
  heading: { fontSize: 17, fontWeight: '700', marginTop: 12 },
  hint: { color: '#4b5563' },
  input: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    width: 100,
  },
  name: { fontSize: 19, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  submit: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    marginTop: 12,
    padding: 14,
  },
  submitText: { color: '#fff', fontWeight: '700' },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  warning: { backgroundColor: '#fef3c7', marginTop: 10, padding: 10 },
});
