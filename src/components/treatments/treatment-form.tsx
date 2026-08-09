import { useState } from 'react';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import {
  Platform,
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
  assertValidTreatmentPhases,
  formatHalfUnits,
  isLegacyTreatmentPhase,
  type IntakeSlot,
  type ScheduledTreatmentPhase,
  type TreatmentDraft,
  type TreatmentPhase,
  type Weekday,
} from '@/domain/treatments/treatment';
import {
  AppButton,
  AppField,
  Message,
  colors,
  radii,
  sizes,
  spacing,
  typography,
} from '@/ui';

import {
  civilDateToPickerDate,
  formatFrenchCivilDate,
  pickerDateToCivilDate,
} from './civil-date';

const DAY_LABELS: Record<Weekday, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
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
  const [phases, setPhases] = useState<TreatmentPhase[]>(initialValue.phases);
  const [active, setActive] = useState(initialValue.active);
  const [included, setIncluded] = useState(initialValue.includedInPillbox);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    try {
      const orderedPhases = orderPhases(phases);
      assertValidTreatmentPhases(orderedPhases);
      setSaving(true);
      setError(null);
      await onSubmit({
        ...initialValue,
        active,
        includedInPillbox: included,
        phases: orderedPhases,
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  function updatePhase(index: number, phase: ScheduledTreatmentPhase) {
    setPhases(
      phases.map((item, itemIndex) => (itemIndex === index ? phase : item)),
    );
  }

  return (
    <View style={styles.form}>
      <Text style={styles.name}>{initialValue.specialtyName}</Text>
      <Text>CIS {initialValue.specialtyCis}</Text>
      {initialValue.pharmaceuticalForm ? (
        <Text>{initialValue.pharmaceuticalForm}</Text>
      ) : null}
      <Message tone="warning" title="Posologie à vérifier">
        La posologie est saisie par vous. Elle n’est jamais déduite du
        médicament.
      </Message>
      <Text style={styles.heading}>Phases de traitement</Text>
      {[...phases]
        .map((phase, originalIndex) => ({ phase, originalIndex }))
        .sort((a, b) =>
          (a.phase.startDate ?? '').localeCompare(b.phase.startDate ?? ''),
        )
        .map(({ phase, originalIndex }, displayedIndex) =>
          isLegacyTreatmentPhase(phase) ? (
            <View
              key={`legacy-${phase.id ?? originalIndex}`}
              style={styles.phase}
            >
              <Text style={styles.phaseTitle}>Posologie existante</Text>
              <Text style={styles.hint}>
                Conservée exactement comme avant la migration. Pour utiliser les
                phases datées, supprimez-la puis ajoutez une phase.
              </Text>
              {phase.dosage.map((item) => (
                <Text key={`${item.weekday}-${item.slot}`}>
                  {DAY_LABELS[item.weekday]} · {SLOT_LABELS[item.slot]} :{' '}
                  {formatHalfUnits(item.quantityHalfUnits)}
                </Text>
              ))}
              <RemoveButton
                onPress={() =>
                  setPhases(
                    phases.filter((_item, index) => index !== originalIndex),
                  )
                }
              />
            </View>
          ) : (
            <PhaseEditor
              key={`phase-${phase.id ?? originalIndex}`}
              number={displayedIndex + 1}
              phase={phase}
              onChange={(value) => updatePhase(originalIndex, value)}
              onRemove={() =>
                setPhases(
                  phases.filter((_item, index) => index !== originalIndex),
                )
              }
            />
          ),
        )}
      <AppButton
        label="Ajouter une phase"
        variant="secondary"
        onPress={() => setPhases([...phases, emptyPhase()])}
      />
      <Toggle label="Traitement actif" value={active} onChange={setActive} />
      <Toggle
        label="Inclure dans le pilulier"
        value={included}
        onChange={setIncluded}
      />
      {error ? (
        <Message tone="error" title="Traitement non enregistré">
          {error}
        </Message>
      ) : null}
      <AppButton
        label={submitLabel}
        loading={saving}
        onPress={() => void submit()}
      />
    </View>
  );
}

function PhaseEditor({
  number,
  phase,
  onChange,
  onRemove,
}: {
  number: number;
  phase: ScheduledTreatmentPhase;
  onChange: (phase: ScheduledTreatmentPhase) => void;
  onRemove: () => void;
}) {
  const frequency = phase.frequency;
  return (
    <View style={styles.phase}>
      <Text style={styles.phaseTitle}>Phase {number}</Text>
      <DateField
        label="Début"
        value={phase.startDate}
        onChange={(startDate) => onChange({ ...phase, startDate })}
      />
      <DateField
        label="Fin optionnelle"
        value={phase.endDate ?? ''}
        onChange={(value) =>
          onChange({ ...phase, endDate: value.trim() === '' ? null : value })
        }
      />
      <Text style={styles.label}>Fréquence</Text>
      <View style={styles.row}>
        <Choice
          label="Tous les jours"
          selected={frequency.type === 'daily'}
          onPress={() => onChange({ ...phase, frequency: { type: 'daily' } })}
        />
        <Choice
          label="Tous les N jours"
          selected={frequency.type === 'interval'}
          onPress={() =>
            onChange({
              ...phase,
              frequency: { type: 'interval', everyNDays: 2, anchorDate: '' },
            })
          }
        />
        <Choice
          label="1 fois/semaine"
          selected={frequency.type === 'weekly'}
          onPress={() =>
            onChange({
              ...phase,
              frequency: { type: 'weekly', weekday: null },
            })
          }
        />
      </View>
      {frequency.type === 'interval' ? (
        <>
          <DateField
            label="Date d’ancrage"
            value={frequency.anchorDate}
            onChange={(anchorDate) =>
              onChange({ ...phase, frequency: { ...frequency, anchorDate } })
            }
          />
          <View style={styles.fieldRow}>
            <AppField
              label="Nombre de jours entre les prises"
              inputMode="numeric"
              style={styles.compactInput}
              value={String(frequency.everyNDays)}
              onChangeText={(value) =>
                onChange({
                  ...phase,
                  frequency: { ...frequency, everyNDays: Number(value) },
                })
              }
            />
          </View>
        </>
      ) : null}
      {frequency.type === 'weekly' ? (
        <View style={styles.row}>
          {WEEKDAYS.map((day) => (
            <Choice
              key={day}
              label={DAY_LABELS[day]}
              selected={frequency.weekday === day}
              onPress={() =>
                onChange({
                  ...phase,
                  frequency: { type: 'weekly', weekday: day },
                })
              }
            />
          ))}
        </View>
      ) : null}
      <Text style={styles.label}>Quantité par créneau</Text>
      {INTAKE_SLOTS.map((slot) => {
        const item = phase.dosage.find((dosage) => dosage.slot === slot);
        return (
          <View key={slot} style={styles.fieldRow}>
            <AppField
              label={`Quantité ${SLOT_LABELS[slot]}`}
              accessibilityLabel={`Quantité ${SLOT_LABELS[slot]} phase ${number}`}
              inputMode="decimal"
              placeholder="0"
              style={styles.compactInput}
              value={
                item ? String(item.quantityHalfUnits / 2).replace('.', ',') : ''
              }
              onChangeText={(value) =>
                onChange({ ...phase, dosage: updateDosage(phase, slot, value) })
              }
            />
          </View>
        );
      })}
      <Text style={styles.hint}>
        Saisissez explicitement chaque créneau. Multiples de 0,5 acceptés.
      </Text>
      <RemoveButton onPress={onRemove} />
    </View>
  );
}

function updateDosage(
  phase: ScheduledTreatmentPhase,
  slot: IntakeSlot,
  value: string,
) {
  const withoutSlot = phase.dosage.filter((item) => item.slot !== slot);
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return withoutSlot;
  const quantityHalfUnits = Number(normalized) * 2;
  return [...withoutSlot, { slot, quantityHalfUnits }];
}

function emptyPhase(): ScheduledTreatmentPhase {
  return {
    id: null,
    startDate: '',
    endDate: null,
    frequency: { type: 'daily' },
    dosage: [],
  };
}

function orderPhases(phases: readonly TreatmentPhase[]): TreatmentPhase[] {
  return [...phases].sort((left, right) =>
    (left.startDate ?? '').localeCompare(right.startDate ?? ''),
  );
}

function DateField({
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
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}
function RemoveButton({ onPress }: { onPress: () => void }) {
  return (
    <AppButton
      label="Supprimer cette phase"
      variant="quiet"
      onPress={onPress}
    />
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
    minHeight: sizes.touch,
    paddingVertical: 10,
  },
  choiceSelected: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
    borderWidth: 2,
  },
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
  compactInput: { width: 100 },
  fieldLabel: { flex: 1 },
  fieldRow: { alignItems: 'center', flexDirection: 'row', marginTop: 8 },
  form: { gap: spacing.md },
  heading: { ...typography.heading, marginTop: 12 },
  hint: typography.caption,
  input: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    width: 100,
  },
  label: { fontWeight: '600', marginTop: 8 },
  name: typography.title,
  phase: {
    borderColor: '#d1d5db',
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 6,
    marginTop: 8,
    padding: 12,
  },
  phaseTitle: { fontSize: 16, fontWeight: '700' },
  remove: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6 },
  removeText: { color: '#b91c1c' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  secondaryButton: {
    borderColor: '#2563eb',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  secondaryButtonText: {
    color: '#1d4ed8',
    fontWeight: '700',
    textAlign: 'center',
  },
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
});
