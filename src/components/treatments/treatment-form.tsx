import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { StyleSheet, Text, View } from 'react-native';

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
  AppCard,
  AppField,
  Banner,
  ChoicePills,
  DenseList,
  DenseRow,
  INTAKE_SLOT_LABELS,
  Message,
  PillButton,
  SectionLabel,
  SelectField,
  Stepper,
  Toggle,
  WEEKDAY_LABELS,
  WEEKDAY_OPTIONS,
  colors,
  typography,
} from '@/ui';

import { nextCivilDay, pickerDateToCivilDate } from './civil-date';
import { DateField } from './date-field';

type FrequencyChoice = 'daily' | 'interval' | 'weekly';

const FREQUENCY_OPTIONS: readonly { value: FrequencyChoice; label: string }[] =
  [
    { value: 'daily', label: 'Chaque jour' },
    { value: 'interval', label: 'Tous les N jours' },
    { value: 'weekly', label: 'Chaque semaine' },
  ];

type Props = {
  /**
   * Reçue en prop pour distinguer explicitement la base personnelle du
   * référentiel médicaments partagé utilisé lors des vérifications.
   */
  personalDatabase: SQLiteDatabase;
  initialValue: TreatmentDraft;
  /**
   * `null` pour un traitement en cours de création, pas encore enregistré :
   * transmis au calcul du signal de stock manquant, qui ne peut alors
   * s'appuyer sur aucune équivalence générique mémorisée pour lui.
   */
  treatmentId: number | null;
  /**
   * CIS d'équivalences génériques déjà confirmées explicitement pendant
   * cette création, en attente d'écriture en base faute d'identifiant :
   * comptent comme couvrant le traitement au même titre qu'une équivalence
   * mémorisée. Sans effet une fois `treatmentId` connu.
   */
  pendingEquivalenceCis?: readonly string[];
  submitLabel: string;
  onSubmit: (value: TreatmentDraft) => Promise<void>;
  /**
   * Masqué lorsque l'écran appelant décide déjà de l'inclusion (création,
   * où le type de posologie est choisi en tête d'écran) : deux contrôles pour
   * le même réglage pourraient se contredire à l'écran.
   */
  showPillboxToggle?: boolean;
};

export function TreatmentForm({
  personalDatabase,
  initialValue,
  treatmentId,
  pendingEquivalenceCis = [],
  submitLabel,
  onSubmit,
  showPillboxToggle = true,
}: Props) {
  const database = personalDatabase;
  const router = useRouter();
  const [phases, setPhases] = useState<TreatmentPhase[]>(() =>
    initialPhases(initialValue.phases),
  );
  const [included, setIncluded] = useState(initialValue.includedInPillbox);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [withoutStock, setWithoutStock] = useState<boolean | null>(null);
  // Recréé à chaque rendu par l'écran de création : comparer son contenu
  // plutôt que sa référence évite de recharger le stock à chaque frappe.
  const pendingEquivalenceCisKey = pendingEquivalenceCis.join(',');

  // Recalculé à chaque focus, pas seulement au montage : l'écran reste monté
  // dans la pile pendant un aller-retour vers l'ajout de boîte.
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
      <Banner level="warning" title="Posologie à vérifier">
        La posologie est saisie par vous. Elle n’est jamais déduite du
        médicament.
      </Banner>
      {withoutStock && included ? (
        <>
          <Banner level="warning" title="Aucune boîte en stock">
            Aucune boîte en stock ne correspond actuellement à cette spécialité.
          </Banner>
          <PillButton
            height={46}
            label="Ajouter une boîte au stock"
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
            tone="outline"
          />
        </>
      ) : null}

      <SectionLabel>Phases de traitement</SectionLabel>
      {[...phases]
        .map((phase, originalIndex) => ({ phase, originalIndex }))
        .sort((a, b) =>
          (a.phase.startDate ?? '').localeCompare(b.phase.startDate ?? ''),
        )
        .map(({ phase, originalIndex }, displayedIndex) =>
          isLegacyTreatmentPhase(phase) ? (
            <AppCard key={`legacy-${phase.id ?? originalIndex}`}>
              <Text style={styles.phaseTitle}>Posologie existante</Text>
              <Text style={typography.micro}>
                Conservée exactement comme avant la migration. Pour utiliser les
                phases datées, supprimez-la puis ajoutez une phase.
              </Text>
              <DenseList tone="muted">
                {phase.dosage.map((item, index) => (
                  <DenseRow
                    first={index === 0}
                    key={`${item.weekday}-${item.slot}`}
                    title={`${WEEKDAY_LABELS[item.weekday]} · ${INTAKE_SLOT_LABELS[item.slot]}`}
                    trailing={
                      <Text style={styles.legacyQuantity}>
                        {formatHalfUnits(item.quantityHalfUnits)}
                      </Text>
                    }
                  />
                ))}
              </DenseList>
              <PillButton
                height={44}
                label="Supprimer cette phase"
                onPress={() =>
                  setPhases(
                    phases.filter((_item, index) => index !== originalIndex),
                  )
                }
                tone="destructive"
              />
            </AppCard>
          ) : (
            <PhaseEditor
              key={`phase-${phase.id ?? originalIndex}`}
              number={displayedIndex + 1}
              onChange={(value) => updatePhase(originalIndex, value)}
              onRemove={() =>
                setPhases(
                  phases.filter((_item, index) => index !== originalIndex),
                )
              }
              phase={phase}
            />
          ),
        )}
      <PillButton
        height={46}
        label="Ajouter une phase"
        onPress={() => setPhases([...phases, nextPhase(phases)])}
        tone="outline"
      />

      {showPillboxToggle ? (
        <DenseList>
          <Toggle
            help="Sinon la prise reste suivie, hors préparation."
            label="Inclure dans le pilulier"
            onChange={setIncluded}
            value={included}
          />
        </DenseList>
      ) : null}

      {error ? (
        <Message tone="error" title="Traitement non enregistré">
          {error}
        </Message>
      ) : null}
      <PillButton
        disabled={saving}
        label={submitLabel}
        onPress={() => void submit()}
      />
    </View>
  );
}

/**
 * Une phase 1 vide est proposée d’emblée : la posologie se saisit sans étape
 * préalable. Les phases suivantes restent ajoutées explicitement. Sa date de
 * début est préremplie au lendemain de la date du jour (device local), pour
 * éviter une saisie manuelle systématique dans le cas courant ; elle reste
 * librement modifiable ou effaçable.
 */
export function initialPhases(
  phases: readonly TreatmentPhase[],
): TreatmentPhase[] {
  if (phases.length > 0) return [...phases];
  const tomorrow = nextCivilDay(pickerDateToCivilDate(new Date()));
  return [{ ...emptyPhase(), startDate: tomorrow ?? '' }];
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
    <AppCard>
      <Text style={styles.phaseTitle}>Phase {number}</Text>
      <DateField
        label="Début"
        onChange={(startDate) => onChange({ ...phase, startDate })}
        value={phase.startDate}
      />
      <DateField
        label="Fin optionnelle"
        onChange={(value) =>
          onChange({ ...phase, endDate: value.trim() === '' ? null : value })
        }
        value={phase.endDate ?? ''}
      />

      <SectionLabel>Fréquence</SectionLabel>
      <ChoicePills
        height={42}
        onChange={(next) =>
          onChange({ ...phase, frequency: frequencyFor(next) })
        }
        options={FREQUENCY_OPTIONS}
        value={frequency.type}
      />
      {frequency.type === 'interval' ? (
        <>
          <DateField
            label="Date d’ancrage"
            onChange={(anchorDate) =>
              onChange({ ...phase, frequency: { ...frequency, anchorDate } })
            }
            value={frequency.anchorDate}
          />
          <AppField
            inputMode="numeric"
            label="Nombre de jours entre les prises"
            onChangeText={(value) =>
              onChange({
                ...phase,
                frequency: { ...frequency, everyNDays: Number(value) },
              })
            }
            style={styles.compactInput}
            value={String(frequency.everyNDays)}
          />
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

      <SectionLabel>Posologie</SectionLabel>
      <DenseList>
        {INTAKE_SLOTS.map((slot, index) => {
          const item = phase.dosage.find((dosage) => dosage.slot === slot);
          const units = (item?.quantityHalfUnits ?? 0) / 2;
          return (
            <DenseRow
              first={index === 0}
              key={slot}
              title={
                <Text style={styles.slotLabel}>{INTAKE_SLOT_LABELS[slot]}</Text>
              }
              trailing={
                <Stepper
                  format={(value) => formatHalfUnits(Math.round(value * 2))}
                  label={`posologie ${INTAKE_SLOT_LABELS[slot].toLowerCase()}, phase ${number}`}
                  min={0}
                  onChange={(value) =>
                    onChange({
                      ...phase,
                      dosage: updateDosage(phase, slot, value),
                    })
                  }
                  step={0.5}
                  value={units}
                />
              }
            />
          );
        })}
      </DenseList>
      <Text style={typography.micro}>
        Les demi-doses sont acceptées pour les comprimés sécables.
      </Text>
      <PillButton
        height={44}
        label="Supprimer cette phase"
        onPress={onRemove}
        tone="destructive"
      />
    </AppCard>
  );
}

function frequencyFor(
  choice: FrequencyChoice,
): ScheduledTreatmentPhase['frequency'] {
  if (choice === 'daily') return { type: 'daily' };
  if (choice === 'weekly') return { type: 'weekly', weekday: null };
  return { type: 'interval', everyNDays: 2, anchorDate: '' };
}

function updateDosage(
  phase: ScheduledTreatmentPhase,
  slot: IntakeSlot,
  units: number,
) {
  const withoutSlot = phase.dosage.filter((item) => item.slot !== slot);
  if (units <= 0) return withoutSlot;
  return [...withoutSlot, { slot, quantityHalfUnits: Math.round(units * 2) }];
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

const styles = StyleSheet.create({
  form: { gap: 12 },
  phaseTitle: { ...typography.cardTitle, fontSize: 15.5, lineHeight: 19 },
  compactInput: { maxWidth: 140 },
  slotLabel: { ...typography.itemTitle, fontSize: 14.5, lineHeight: 19 },
  legacyQuantity: {
    ...typography.numeric,
    color: colors.text,
    fontSize: 15,
    lineHeight: 18,
  },
});
