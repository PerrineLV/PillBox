import { useCallback, useState } from 'react';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { isTreatmentWithoutStock } from '@/domain/inventory/box-attachment';
import {
  INTAKE_SLOTS,
  assertValidTreatmentPhases,
  formatHalfUnits,
  isLegacyTreatmentPhase,
  type IntakeSlot,
  type ScheduledTreatmentPhase,
  type TreatmentDraft,
  type TreatmentPhase,
} from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  AppButton,
  AppField,
  INTAKE_SLOT_LABELS,
  Message,
  SelectField,
  SlotCard,
  SlotGrid,
  WEEKDAY_LABELS,
  WEEKDAY_OPTIONS,
  colors,
  radii,
  sizes,
  spacing,
  typography,
} from '@/ui';

import {
  civilDateToPickerDate,
  formatFrenchCivilDate,
  nextCivilDay,
  pickerDateToCivilDate,
} from './civil-date';

type Props = {
  initialValue: TreatmentDraft;
  /**
   * `null` pour un traitement en cours de création, pas encore enregistré :
   * transmis au calcul du signal de stock manquant (ticket 29), qui ne peut
   * alors s'appuyer sur aucune équivalence générique mémorisée pour lui.
   */
  treatmentId: number | null;
  /**
   * CIS d'équivalences génériques déjà confirmées explicitement pendant
   * cette création (ticket 29), en attente d'écriture en base faute
   * d'identifiant : comptent comme couvrant le traitement au même titre
   * qu'une équivalence mémorisée, pour ne jamais afficher un signal que
   * cette confirmation contredirait. Sans effet une fois `treatmentId` connu.
   */
  pendingEquivalenceCis?: readonly string[];
  submitLabel: string;
  onSubmit: (value: TreatmentDraft) => Promise<void>;
};

export function TreatmentForm({
  initialValue,
  treatmentId,
  pendingEquivalenceCis = [],
  submitLabel,
  onSubmit,
}: Props) {
  const database = useSQLiteContext();
  const router = useRouter();
  const [phases, setPhases] = useState<TreatmentPhase[]>(() =>
    initialPhases(initialValue.phases),
  );
  const [included, setIncluded] = useState(initialValue.includedInPillbox);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [withoutStock, setWithoutStock] = useState<boolean | null>(null);
  // Recréé à chaque rendu par l'écran de création : comparer son contenu
  // plutôt que sa référence évite de recharger le stock à chaque frappe dans
  // le formulaire.
  const pendingEquivalenceCisKey = pendingEquivalenceCis.join(',');

  // Recalculé à chaque focus, pas seulement au montage : l'écran reste monté
  // dans la pile de navigation pendant un aller-retour vers l'ajout de boîte
  // (ticket 29), un simple useEffect ne se redéclencherait donc jamais au
  // retour.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([
        listMedicationBoxes(database),
        treatmentId === null
          ? Promise.resolve([])
          : listGenericEquivalenceConfirmations(database, treatmentId),
      ])
        .then(([boxes, equivalences]) => {
          if (!cancelled)
            setWithoutStock(
              isTreatmentWithoutStock(
                initialValue.specialtyCis,
                treatmentId,
                boxes,
                equivalences,
                pendingEquivalenceCis,
              ),
            );
        })
        .catch(() => {
          if (!cancelled) setWithoutStock(null);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      database,
      initialValue.specialtyCis,
      treatmentId,
      pendingEquivalenceCisKey,
    ]),
  );

  async function submit() {
    try {
      const orderedPhases = orderPhases(phases);
      assertValidTreatmentPhases(orderedPhases);
      setSaving(true);
      setError(null);
      await onSubmit({
        ...initialValue,
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
      {withoutStock && included ? (
        <>
          <Message tone="warning" title="Aucune boîte en stock">
            Aucune boîte en stock ne correspond actuellement à cette spécialité.
          </Message>
          <AppButton
            label="Ajouter une boîte au stock"
            variant="secondary"
            onPress={() =>
              router.push(
                treatmentId === null
                  ? {
                      pathname: '/inventory/new',
                      params: {
                        draftTreatmentCis: initialValue.specialtyCis,
                        draftTreatmentName: initialValue.specialtyName,
                      },
                    }
                  : '/inventory/new',
              )
            }
          />
        </>
      ) : null}
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
                  {WEEKDAY_LABELS[item.weekday]} ·{' '}
                  {INTAKE_SLOT_LABELS[item.slot]} :{' '}
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
        onPress={() => setPhases([...phases, nextPhase(phases)])}
      />
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

/**
 * Une phase 1 vide est proposée d’emblée : la posologie se saisit sans étape
 * préalable. Les phases suivantes restent ajoutées explicitement.
 */
export function initialPhases(
  phases: readonly TreatmentPhase[],
): TreatmentPhase[] {
  return phases.length > 0 ? [...phases] : [emptyPhase()];
}

/**
 * Une phase ajoutée démarre par défaut le lendemain de la dernière fin de
 * phase saisie : les phases ne peuvent pas se chevaucher. Sans date de fin
 * connue, la date reste à saisir — elle n’est jamais devinée.
 */
export function nextPhase(
  phases: readonly TreatmentPhase[],
): ScheduledTreatmentPhase {
  const lastEndDate = phases.reduce<string | null>((latest, phase) => {
    const endDate = isLegacyTreatmentPhase(phase) ? null : phase.endDate;
    if (endDate === null || endDate === '') return latest;
    return latest === null || endDate > latest ? endDate : latest;
  }, null);
  const startDate = lastEndDate === null ? null : nextCivilDay(lastEndDate);
  return { ...emptyPhase(), startDate: startDate ?? '' };
}

export function PhaseEditor({
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
        <SelectField
          accessibilityLabel={`Jour de la prise hebdomadaire, phase ${number}`}
          label="Jour de la prise"
          onChange={(weekday) =>
            onChange({ ...phase, frequency: { type: 'weekly', weekday } })
          }
          options={WEEKDAY_OPTIONS}
          placeholder="Choisir un jour"
          value={frequency.weekday}
        />
      ) : null}
      <Text style={styles.label}>Posologie</Text>
      <SlotGrid>
        {INTAKE_SLOTS.map((slot) => {
          const item = phase.dosage.find((dosage) => dosage.slot === slot);
          return (
            <SlotCard key={slot} label={INTAKE_SLOT_LABELS[slot]}>
              <TextInput
                accessibilityLabel={`Posologie ${INTAKE_SLOT_LABELS[slot]}, phase ${number}`}
                inputMode="decimal"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                style={styles.slotInput}
                value={
                  item
                    ? String(item.quantityHalfUnits / 2).replace('.', ',')
                    : ''
                }
                onChangeText={(value) =>
                  onChange({
                    ...phase,
                    dosage: updateDosage(phase, slot, value),
                  })
                }
              />
            </SlotCard>
          );
        })}
      </SlotGrid>
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
  slotInput: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
  fieldRow: { alignItems: 'center', flexDirection: 'row', marginTop: 8 },
  form: { gap: spacing.md },
  heading: { ...typography.heading, marginTop: 12 },
  hint: typography.caption,
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  secondaryButtonText: {
    color: '#1d4ed8',
    fontWeight: '700',
    textAlign: 'center',
  },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
});
