import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { TreatmentDraft } from '@/domain/treatments/treatment';
import { AppField, Banner, Message, PillButton } from '@/ui';

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
      <Banner level="warning" title="Traitement si besoin">
        Ce traitement est pris ponctuellement, sans posologie planifiée. Il
        n’est jamais inclus dans le pilulier et ne génère aucun rappel
        automatique.
      </Banner>
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
      <Banner level="neutral">
        Ces limites sont celles que vous saisissez. PillBox les rappelle sur
        l’écran de prise et y désactive l’enregistrement tant qu’elles ne sont
        pas respectées ; elle ne calcule jamais de posologie, ne déduit aucune
        limite et ne déclenche aucune alerte.
      </Banner>
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
  form: { gap: 12 },
});
