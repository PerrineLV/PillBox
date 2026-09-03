import { WEEKDAY_LABELS } from '@/ui/labels';
import {
  formatHalfUnits,
  isLegacyTreatmentPhase,
  type IntakeSlot,
  type Treatment,
  type TreatmentPhase,
} from '@/domain/treatments/treatment';

/**
 * Familles de traitements telles qu'on les filtre à l'écran. Elles ne
 * qualifient que la façon dont la prise est suivie, jamais le médicament.
 */
export type TreatmentCategory = 'PILLBOX' | 'OUTSIDE' | 'AS_NEEDED';

export function treatmentCategory(treatment: Treatment): TreatmentCategory {
  if (treatment.dosageKind === 'AS_NEEDED') return 'AS_NEEDED';
  return treatment.includedInPillbox ? 'PILLBOX' : 'OUTSIDE';
}

export const TREATMENT_CATEGORY_LABELS: Record<TreatmentCategory, string> = {
  PILLBOX: 'Dans le pilulier',
  OUTSIDE: 'Hors pilulier',
  AS_NEEDED: 'Si besoin',
};

const SLOT_WORDS = {
  morning: 'matin',
  noon: 'midi',
  evening: 'soir',
  bedtime: 'coucher',
} as const;

/** Résumé lisible de la posologie, jamais déduit : il ne relit que les phases saisies. */
export function treatmentPosologySummary(treatment: Treatment): string {
  if (treatment.dosageKind === 'AS_NEEDED')
    return 'Pris ponctuellement, sans posologie planifiée.';
  if (treatment.phases.length === 0) return 'Aucune phase de posologie.';
  return treatment.phases.map(phaseSummary).join(' Puis ');
}

/**
 * Phase en vigueur à la date donnée, ou `null`. Une phase historique sans
 * dates (posologie importée avant les phases datées) est considérée en
 * vigueur seulement si aucune phase datée ne l'est : elle décrit encore la
 * posologie courante.
 */
export function currentPhase(
  treatment: Treatment,
  today: string,
): TreatmentPhase | null {
  const dated = treatment.phases.find(
    (phase) =>
      !isLegacyTreatmentPhase(phase) &&
      phase.startDate <= today &&
      (phase.endDate === null || phase.endDate >= today),
  );
  if (dated) return dated;
  return treatment.phases.find(isLegacyTreatmentPhase) ?? null;
}

/** Quantité en demi-unités servie par créneau pour une phase donnée. */
export function phaseSlotQuantities(
  phase: TreatmentPhase | null,
): Record<IntakeSlot, number> {
  const quantities: Record<IntakeSlot, number> = {
    morning: 0,
    noon: 0,
    evening: 0,
    bedtime: 0,
  };
  if (phase === null) return quantities;
  for (const item of phase.dosage)
    quantities[item.slot] += item.quantityHalfUnits;
  return quantities;
}

/** Libellé de la plage couverte par une phase, sans jamais inventer de date. */
export function phaseRangeLabel(
  phase: TreatmentPhase,
  formatDate: (value: string) => string,
): string {
  if (isLegacyTreatmentPhase(phase)) return 'Posologie existante';
  const start = `Depuis le ${formatDate(phase.startDate)}`;
  return phase.endDate === null
    ? start
    : `Du ${formatDate(phase.startDate)} au ${formatDate(phase.endDate)}`;
}

export function phaseFrequencySummary(phase: TreatmentPhase): string {
  return phaseSummary(phase);
}

function phaseSummary(phase: TreatmentPhase): string {
  if (phase.frequency.type === 'legacy-weekdays')
    return `Posologie existante · ${phase.dosage.length} prise(s)`;
  const dosage = phase.dosage
    .map(
      (item) =>
        `${formatHalfUnits(item.quantityHalfUnits)} ${SLOT_WORDS[item.slot]}`,
    )
    .join(', ');
  return `${frequencyLabel(phase.frequency)} · ${dosage}`;
}

function frequencyLabel(
  frequency: Extract<
    TreatmentPhase['frequency'],
    { type: 'daily' | 'interval' | 'weekly' }
  >,
): string {
  if (frequency.type === 'daily') return 'Chaque jour';
  if (frequency.type === 'interval')
    return `Tous les ${frequency.everyNDays} jours`;
  return frequency.weekday
    ? `Chaque ${WEEKDAY_LABELS[frequency.weekday].toLowerCase()}`
    : 'Jour hebdomadaire non renseigné';
}
