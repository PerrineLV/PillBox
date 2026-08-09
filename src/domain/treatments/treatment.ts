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

export type Dosage = {
  weekday: Weekday;
  slot: IntakeSlot;
  /** Quantité exprimée en demi-unités : 1 = 0,5 et 3 = 1,5. */
  quantityHalfUnits: number;
};

export type Treatment = {
  id: number;
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
  active: boolean;
  includedInPillbox: boolean;
  dosage: Dosage[];
};

export type TreatmentDraft = Omit<Treatment, 'id'>;

export function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some((weekday) => weekday === value);
}

export function isIntakeSlot(value: string): value is IntakeSlot {
  return INTAKE_SLOTS.some((slot) => slot === value);
}

export function assertValidDosage(dosage: readonly Dosage[]): void {
  if (dosage.length === 0) {
    throw new Error('La posologie doit contenir au moins une prise.');
  }

  const keys = new Set<string>();
  for (const item of dosage) {
    if (
      !Number.isSafeInteger(item.quantityHalfUnits) ||
      item.quantityHalfUnits <= 0
    ) {
      throw new Error('Chaque quantité doit être un multiple positif de 0,5.');
    }
    const key = `${item.weekday}:${item.slot}`;
    if (keys.has(key)) throw new Error('Une prise est définie plusieurs fois.');
    keys.add(key);
  }
}

export function formatHalfUnits(quantityHalfUnits: number): string {
  const whole = Math.floor(quantityHalfUnits / 2);
  return quantityHalfUnits % 2 === 0 ? String(whole) : `${whole},5`;
}
