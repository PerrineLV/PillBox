import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { TreatmentDraft } from '@/domain/treatments/treatment';
import { AppButton, AppField, Message, spacing, typography } from '@/ui';

type Props = {
  initialValue: TreatmentDraft;
  submitLabel: string;
  onSubmit: (value: TreatmentDraft) => Promise<void>;
};

/**
 * Formulaire dédié aux traitements « si besoin » (ticket 19) : pas de phase de
 * posologie, jamais inclus dans le pilulier. Les deux champs optionnels sont
 * de simples notes affichées, jamais utilisées pour calculer un délai avant
 * reprise.
 */
export function AsNeededTreatmentForm({
  initialValue,
  submitLabel,
  onSubmit,
}: Props) {
  const [maxQuantityText, setMaxQuantityText] = useState(
    halfUnitsToText(initialValue.asNeededInfo.maxQuantityPerDayHalfUnits),
  );
  const [minIntervalText, setMinIntervalText] = useState(
    initialValue.asNeededInfo.minIntervalHours === null
      ? ''
      : String(initialValue.asNeededInfo.minIntervalHours),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    try {
      setSaving(true);
      setError(null);
      await onSubmit({
        ...initialValue,
        dosageKind: 'AS_NEEDED',
        includedInPillbox: false,
        phases: [],
        asNeededInfo: {
          maxQuantityPerDayHalfUnits: textToHalfUnits(maxQuantityText),
          minIntervalHours: textToInteger(minIntervalText),
        },
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
      <Message tone="warning" title="Traitement si besoin">
        Ce traitement est pris ponctuellement, sans posologie planifiée. Il
        n’est jamais inclus dans le pilulier et ne génère aucun rappel
        automatique.
      </Message>
      <AppField
        label="Limite maximale par jour (optionnel)"
        inputMode="decimal"
        placeholder="Ex. 4"
        value={maxQuantityText}
        onChangeText={setMaxQuantityText}
      />
      <AppField
        label="Intervalle minimal entre deux prises, en heures (optionnel)"
        inputMode="numeric"
        placeholder="Ex. 6"
        value={minIntervalText}
        onChangeText={setMinIntervalText}
      />
      <Message tone="info">
        Ces informations sont uniquement affichées à titre indicatif. PillBox ne
        calcule jamais quand vous pouvez reprendre ce médicament et ne déclenche
        aucune alerte à partir de ces valeurs.
      </Message>
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

function halfUnitsToText(value: number | null): string {
  return value === null ? '' : String(value / 2).replace('.', ',');
}

function textToHalfUnits(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return null;
  return Math.round(Number(normalized) * 2);
}

function textToInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return Math.round(Number(trimmed));
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  name: typography.title,
});
