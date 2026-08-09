import type { Dosage, IntakeSlot, Treatment } from './treatment';

export type GeneratedIntake = {
  treatmentId: number;
  specialtyCis: string;
  specialtyName: string;
  date: string;
  slot: IntakeSlot;
  quantityHalfUnits: number;
};

/** Génère les prises entre deux dates civiles incluses (format YYYY-MM-DD). */
export function generateIntakes(
  treatments: readonly Treatment[],
  startDate: string,
  endDate: string,
): GeneratedIntake[] {
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);
  if (start.getTime() > end.getTime()) {
    throw new Error('La date de début doit précéder la date de fin.');
  }

  const intakes: GeneratedIntake[] = [];
  for (
    const date = start;
    date.getTime() <= end.getTime();
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const weekdayIndex = (date.getUTCDay() + 6) % 7;
    for (const treatment of treatments) {
      if (!treatment.active || !treatment.includedInPillbox) continue;
      for (const dosage of treatment.dosage) {
        if (weekdayIndex !== weekdayToIndex(dosage)) continue;
        intakes.push({
          treatmentId: treatment.id,
          specialtyCis: treatment.specialtyCis,
          specialtyName: treatment.specialtyName,
          date: formatCivilDate(date),
          slot: dosage.slot,
          quantityHalfUnits: dosage.quantityHalfUnits,
        });
      }
    }
  }
  return intakes;
}

function weekdayToIndex(dosage: Dosage): number {
  const weekdays = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  return weekdays.indexOf(dosage.weekday);
}

function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatCivilDate(date) !== value) {
    throw new Error('Date invalide.');
  }
  return date;
}

function formatCivilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
