import { generateIntakes } from '@/domain/treatments/generate-intakes';
import {
  INTAKE_SLOTS,
  type IntakeSlot,
  type Treatment,
} from '@/domain/treatments/treatment';

export const INTAKE_REMINDER_HORIZON_DAYS = 30;

export type SlotTime = { hour: number; minute: number };
export type TreatmentReminderSettings = {
  treatmentId: number;
  enabled: boolean;
  slotTimes: Partial<Record<IntakeSlot, SlotTime>>;
};
export type PlannedIntakeReminder = {
  scheduledAt: Date;
  treatmentIds: number[];
};

export function planIntakeReminders(
  treatments: readonly Treatment[],
  settings: readonly TreatmentReminderSettings[],
  from: Date,
  until: Date,
): PlannedIntakeReminder[] {
  if (until < from) throw new Error('Horizon de rappel invalide.');
  const settingsByTreatment = new Map(
    settings
      .filter((item) => item.enabled)
      .map((item) => [item.treatmentId, item]),
  );
  const startDate = localCivilDate(from);
  const endDate = localCivilDate(until);
  const grouped = new Map<string, PlannedIntakeReminder>();
  const intakes = generateIntakes(treatments, startDate, endDate, {
    includeTreatmentsOutsidePillbox: true,
  });
  for (const intake of intakes) {
    const time = settingsByTreatment.get(intake.treatmentId)?.slotTimes[
      intake.slot
    ];
    if (time === undefined) continue;
    assertSlotTime(time);
    const scheduledAt = localDateTime(intake.date, time);
    if (scheduledAt < from || scheduledAt > until) continue;
    const key = scheduledAt.toISOString();
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.treatmentIds.includes(intake.treatmentId))
        existing.treatmentIds.push(intake.treatmentId);
    } else {
      grouped.set(key, { scheduledAt, treatmentIds: [intake.treatmentId] });
    }
  }
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      treatmentIds: [...item.treatmentIds].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

export function usedSlots(treatment: Treatment): IntakeSlot[] {
  const slots = new Set(
    treatment.phases.flatMap((phase) => phase.dosage.map((item) => item.slot)),
  );
  return INTAKE_SLOTS.filter((slot) => slots.has(slot));
}

export function localCivilDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateTime(date: string, time: SlotTime): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, time.hour, time.minute, 0, 0);
}

function assertSlotTime(time: SlotTime): void {
  if (
    !Number.isInteger(time.hour) ||
    time.hour < 0 ||
    time.hour > 23 ||
    !Number.isInteger(time.minute) ||
    time.minute < 0 ||
    time.minute > 59
  )
    throw new Error('Heure de prise invalide.');
}
