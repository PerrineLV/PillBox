export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const INTAKE_SLOTS = ['morning', 'noon', 'evening', 'bedtime'] as const;
export type IntakeSlot = (typeof INTAKE_SLOTS)[number];

export type PhaseDosage = {
  slot: IntakeSlot;
  /** Quantité exprimée en demi-unités : 1 = 0,5 et 3 = 1,5. */
  quantityHalfUnits: number;
};

/** Ancien modèle, conservé uniquement pour garantir une migration sans changement. */
export type LegacyDosage = PhaseDosage & { weekday: Weekday };

export type PhaseFrequency =
  | { type: 'daily' }
  | { type: 'interval'; everyNDays: number; anchorDate: string }
  | { type: 'weekly'; weekday: Weekday | null };

export type ScheduledTreatmentPhase = {
  id: number | null;
  startDate: string;
  endDate: string | null;
  frequency: PhaseFrequency;
  dosage: PhaseDosage[];
};

export type LegacyTreatmentPhase = {
  id: number | null;
  startDate: null;
  endDate: null;
  frequency: { type: 'legacy-weekdays' };
  dosage: LegacyDosage[];
};

export type TreatmentPhase = ScheduledTreatmentPhase | LegacyTreatmentPhase;

export type Treatment = {
  id: number;
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
  includedInPillbox: boolean;
  archivedAt: string | null;
  phases: TreatmentPhase[];
};

export type TreatmentDraft = Omit<Treatment, 'id' | 'archivedAt'>;

export function isLegacyTreatmentPhase(
  phase: TreatmentPhase,
): phase is LegacyTreatmentPhase {
  return phase.frequency.type === 'legacy-weekdays';
}

export function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some((weekday) => weekday === value);
}

export function isIntakeSlot(value: string): value is IntakeSlot {
  return INTAKE_SLOTS.some((slot) => slot === value);
}

export function assertValidTreatmentPhases(
  phases: readonly TreatmentPhase[],
): void {
  if (phases.length === 0) {
    throw new Error('Le traitement doit contenir au moins une phase.');
  }

  const scheduled = phases.filter(
    (phase): phase is ScheduledTreatmentPhase => !isLegacyTreatmentPhase(phase),
  );
  if (scheduled.length !== phases.length && phases.length !== 1) {
    throw new Error(
      'La posologie héritée doit être remplacée avant d’ajouter une phase.',
    );
  }

  for (const phase of phases) assertValidPhase(phase);
  const ordered = [...scheduled].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous.endDate === null || current.startDate <= previous.endDate) {
      throw new Error(
        'Les phases ne peuvent pas se chevaucher : chaque phase suivante doit commencer après la fin de la précédente.',
      );
    }
  }
}

function assertValidPhase(phase: TreatmentPhase): void {
  if (isLegacyTreatmentPhase(phase)) {
    assertValidDosage(phase.dosage, true);
    return;
  }
  assertCivilDate(phase.startDate, 'La date de début de phase est invalide.');
  if (phase.endDate !== null) {
    assertCivilDate(phase.endDate, 'La date de fin de phase est invalide.');
    if (phase.endDate < phase.startDate)
      throw new Error('La fin d’une phase doit suivre son début.');
  }
  if (phase.frequency.type === 'interval') {
    if (
      !Number.isSafeInteger(phase.frequency.everyNDays) ||
      phase.frequency.everyNDays < 2
    )
      throw new Error(
        'La fréquence doit être un nombre de jours supérieur à 1.',
      );
    assertCivilDate(
      phase.frequency.anchorDate,
      'La date d’ancrage de la fréquence est invalide.',
    );
  }
  if (phase.frequency.type === 'weekly' && phase.frequency.weekday === null)
    throw new Error(
      'Choisissez explicitement le jour de la prise hebdomadaire.',
    );
  assertValidDosage(phase.dosage, false);
}

function assertValidDosage(
  dosage: readonly (PhaseDosage | LegacyDosage)[],
  legacy: boolean,
): void {
  if (dosage.length === 0)
    throw new Error('Chaque phase doit contenir au moins une prise.');
  const keys = new Set<string>();
  for (const item of dosage) {
    if (
      !Number.isSafeInteger(item.quantityHalfUnits) ||
      item.quantityHalfUnits <= 0
    )
      throw new Error('Chaque quantité doit être un multiple positif de 0,5.');
    const weekday = legacy && 'weekday' in item ? item.weekday : '';
    const key = `${weekday}:${item.slot}`;
    if (keys.has(key)) throw new Error('Une prise est définie plusieurs fois.');
    keys.add(key);
  }
}

function assertCivilDate(value: string, message: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(message);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error(message);
}

export function formatHalfUnits(quantityHalfUnits: number): string {
  const whole = Math.floor(quantityHalfUnits / 2);
  return quantityHalfUnits % 2 === 0 ? String(whole) : `${whole},5`;
}
