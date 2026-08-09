import {
  WEEKDAYS,
  isLegacyTreatmentPhase,
  type IntakeSlot,
  type LegacyDosage,
  type ScheduledTreatmentPhase,
  type Treatment,
  type TreatmentPhase,
} from './treatment';

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
  options: { includeTreatmentsOutsidePillbox?: boolean } = {},
): GeneratedIntake[] {
  const startDay = civilDay(startDate);
  const endDay = civilDay(endDate);
  if (startDay > endDay)
    throw new Error('La date de début doit précéder la date de fin.');

  const intakes: GeneratedIntake[] = [];
  for (let day = startDay; day <= endDay; day += 1) {
    const date = formatCivilDay(day);
    for (const treatment of treatments) {
      if (
        !treatment.active ||
        treatment.archivedAt !== null ||
        (!options.includeTreatmentsOutsidePillbox &&
          !treatment.includedInPillbox)
      )
        continue;
      for (const phase of treatment.phases) {
        if (!phaseApplies(phase, date, day)) continue;
        const dosage = dosageForDay(phase, day);
        for (const item of dosage)
          intakes.push({
            treatmentId: treatment.id,
            specialtyCis: treatment.specialtyCis,
            specialtyName: treatment.specialtyName,
            date,
            slot: item.slot,
            quantityHalfUnits: item.quantityHalfUnits,
          });
      }
    }
  }
  return intakes;
}

function phaseApplies(
  phase: TreatmentPhase,
  date: string,
  day: number,
): boolean {
  if (isLegacyTreatmentPhase(phase)) return true;
  if (
    date < phase.startDate ||
    (phase.endDate !== null && date > phase.endDate)
  )
    return false;
  if (phase.frequency.type === 'daily') return true;
  if (phase.frequency.type === 'weekly')
    return (
      phase.frequency.weekday !== null &&
      weekdayIndex(day) === WEEKDAYS.indexOf(phase.frequency.weekday)
    );
  const anchorDay = civilDay(phase.frequency.anchorDate);
  return modulo(day - anchorDay, phase.frequency.everyNDays) === 0;
}

function dosageForDay(
  phase: TreatmentPhase,
  day: number,
): readonly (ScheduledTreatmentPhase['dosage'][number] | LegacyDosage)[] {
  if (!isLegacyTreatmentPhase(phase)) return phase.dosage;
  const weekday = WEEKDAYS[weekdayIndex(day)];
  return phase.dosage.filter((item) => item.weekday === weekday);
}

function weekdayIndex(day: number): number {
  return (new Date(day * 86_400_000).getUTCDay() + 6) % 7;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function civilDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('Date invalide.');
  return date.getTime() / 86_400_000;
}

function formatCivilDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
