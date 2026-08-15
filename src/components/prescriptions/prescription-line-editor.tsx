import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  suggestedToleranceDays,
  type PrescriptionItemDispensingMode,
  type PrescriptionItemQuantityKind,
} from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import { detectControlledDispensingMention } from '@/infrastructure/medications/medication-reference';
import {
  AppButton,
  AppField,
  Badge,
  Card,
  SelectField,
  colors,
  sizes,
  spacing,
  typography,
} from '@/ui';

export type PrescriptionLineDraft = {
  key: string;
  /** `null` tant que l'utilisatrice n'a pas choisi ou créé de traitement. */
  treatment: Treatment | null;
  quantityKind: PrescriptionItemQuantityKind;
  durationDaysText: string;
  boxCountText: string;
  dispensingMode: PrescriptionItemDispensingMode;
  periodicityDaysText: string;
  toleranceDaysText: string;
  /** `null` tant que la détection BDPM (asynchrone) n'a pas répondu. */
  isControlledSubstance: boolean | null;
};

export function emptyPrescriptionLine(key: string): PrescriptionLineDraft {
  return {
    key,
    treatment: null,
    quantityKind: 'DURATION',
    durationDaysText: '',
    boxCountText: '',
    dispensingMode: 'FULL',
    periodicityDaysText: '',
    toleranceDaysText: '',
    isControlledSubstance: null,
  };
}

/**
 * `quantityKind` proposé automatiquement selon `dosageKind` du traitement
 * attaché (ticket 46) : `DURATION` par défaut pour un traitement planifié
 * (modifiable ensuite), `BOX_COUNT` forcé pour un traitement « si besoin ».
 */
export function attachTreatmentToLine(
  line: PrescriptionLineDraft,
  treatment: Treatment,
): PrescriptionLineDraft {
  return {
    ...line,
    treatment,
    quantityKind:
      treatment.dosageKind === 'AS_NEEDED' ? 'BOX_COUNT' : 'DURATION',
  };
}

export function PrescriptionLineEditor({
  line,
  treatments,
  referenceDatabase,
  onChange,
  onRemove,
  onRequestNewTreatment,
}: {
  line: PrescriptionLineDraft;
  /** Traitements non archivés proposables au renouvellement. */
  treatments: readonly Treatment[];
  referenceDatabase: SQLiteDatabase;
  onChange: (line: PrescriptionLineDraft) => void;
  onRemove: () => void;
  onRequestNewTreatment: () => void;
}) {
  const [choosingExisting, setChoosingExisting] = useState(false);
  const specialtyCis = line.treatment?.specialtyCis ?? null;

  // Purement informatif (comme l'ancien indicateur du ticket 30) : ne
  // conditionne jamais la validité de la ligne, seulement la suggestion de
  // `toleranceDays` affichée ci-dessous.
  useEffect(() => {
    if (specialtyCis === null || line.isControlledSubstance !== null) return;
    let cancelled = false;
    detectControlledDispensingMention(referenceDatabase, specialtyCis)
      .then((detected) => {
        if (cancelled) return;
        onChange({
          ...line,
          isControlledSubstance: detected,
          toleranceDaysText:
            line.toleranceDaysText === '' && !detected
              ? String(suggestedToleranceDays(detected) ?? '')
              : line.toleranceDaysText,
        });
      })
      .catch(() => {
        if (!cancelled) onChange({ ...line, isControlledSubstance: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceDatabase, specialtyCis]);

  if (line.treatment === null) {
    return (
      <Card style={styles.card}>
        {choosingExisting ? (
          <>
            <SelectField
              label="Traitement à renouveler"
              placeholder="Choisir un traitement"
              value={null}
              options={treatments.map((treatment) => ({
                value: String(treatment.id),
                label: treatment.specialtyName,
              }))}
              onChange={(value) => {
                const treatment = treatments.find(
                  (item) => String(item.id) === value,
                );
                if (treatment) onChange(attachTreatmentToLine(line, treatment));
              }}
            />
            <AppButton
              label="Annuler"
              variant="quiet"
              onPress={() => setChoosingExisting(false)}
            />
          </>
        ) : (
          <>
            <Text style={styles.prompt}>
              Renouvellement d’un traitement existant, ou nouveau traitement
              prescrit sur cette ordonnance ?
            </Text>
            <AppButton
              label="Renouveler un traitement existant"
              variant="secondary"
              disabled={treatments.length === 0}
              onPress={() => setChoosingExisting(true)}
            />
            <AppButton
              label="Ajouter un nouveau traitement"
              variant="secondary"
              onPress={onRequestNewTreatment}
            />
          </>
        )}
        <RemoveLineButton onPress={onRemove} />
      </Card>
    );
  }

  const treatment = line.treatment;
  const isAsNeeded = treatment.dosageKind === 'AS_NEEDED';

  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{treatment.specialtyName}</Text>
      <Badge
        label={isAsNeeded ? 'Si besoin' : 'Posologie planifiée'}
        tone="neutral"
      />
      {isAsNeeded ? (
        <AppField
          label="Nombre de boîtes délivrées"
          inputMode="numeric"
          value={line.boxCountText}
          onChangeText={(text) => onChange({ ...line, boxCountText: text })}
        />
      ) : (
        <>
          <View style={styles.row}>
            <QuantityKindChoice
              label="Durée (jours)"
              selected={line.quantityKind === 'DURATION'}
              onPress={() => onChange({ ...line, quantityKind: 'DURATION' })}
            />
            <QuantityKindChoice
              label="Nombre de boîtes"
              selected={line.quantityKind === 'BOX_COUNT'}
              onPress={() => onChange({ ...line, quantityKind: 'BOX_COUNT' })}
            />
          </View>
          {line.quantityKind === 'DURATION' ? (
            <AppField
              label="Durée couverte (jours)"
              inputMode="numeric"
              value={line.durationDaysText}
              onChangeText={(text) =>
                onChange({ ...line, durationDaysText: text })
              }
            />
          ) : (
            <AppField
              label="Nombre de boîtes délivrées"
              inputMode="numeric"
              value={line.boxCountText}
              onChangeText={(text) => onChange({ ...line, boxCountText: text })}
            />
          )}
        </>
      )}
      <View style={styles.toggle}>
        <Text>Délivrance fractionnée</Text>
        <Switch
          value={line.dispensingMode === 'FRACTIONAL'}
          onValueChange={(fractional) =>
            onChange({
              ...line,
              dispensingMode: fractional ? 'FRACTIONAL' : 'FULL',
            })
          }
        />
      </View>
      {line.dispensingMode === 'FRACTIONAL' ? (
        <>
          <AppField
            label="Périodicité (jours entre deux délivrances)"
            inputMode="numeric"
            value={line.periodicityDaysText}
            onChangeText={(text) =>
              onChange({ ...line, periodicityDaysText: text })
            }
          />
          {line.isControlledSubstance === false ? (
            <AppField
              label="Tolérance autour de la date théorique (jours)"
              inputMode="numeric"
              value={line.toleranceDaysText}
              onChangeText={(text) =>
                onChange({ ...line, toleranceDaysText: text })
              }
            />
          ) : null}
        </>
      ) : null}
      <RemoveLineButton onPress={onRemove} />
    </Card>
  );
}

function QuantityKindChoice({
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

function RemoveLineButton({ onPress }: { onPress: () => void }) {
  return (
    <AppButton label="Retirer cette ligne" variant="quiet" onPress={onPress} />
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginTop: spacing.md },
  choice: {
    borderColor: colors.borderStrong,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: sizes.touch,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  choiceSelected: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
    borderWidth: 2,
  },
  name: typography.heading,
  prompt: { color: colors.textMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
});
