import { isWeekday, type Weekday } from '@/domain/treatments/treatment';

export type PreparationReminderSchedule = Readonly<{
  weekday: Weekday;
  hour: number;
  minute: number;
}>;

export type PreparationReminderSettings = PreparationReminderSchedule &
  Readonly<{
    enabled: boolean;
    notificationId: string | null;
  }>;

const EXPO_WEEKDAYS: Record<Weekday, number> = {
  sunday: 1,
  monday: 2,
  tuesday: 3,
  wednesday: 4,
  thursday: 5,
  friday: 6,
  saturday: 7,
};

export function expoWeekday(weekday: Weekday): number {
  return EXPO_WEEKDAYS[weekday];
}

export function assertValidReminderSchedule(
  schedule: PreparationReminderSchedule,
): void {
  if (!isWeekday(schedule.weekday)) throw new Error('Jour de rappel invalide.');
  if (
    !Number.isInteger(schedule.hour) ||
    schedule.hour < 0 ||
    schedule.hour > 23
  )
    throw new Error('Heure de rappel invalide.');
  if (
    !Number.isInteger(schedule.minute) ||
    schedule.minute < 0 ||
    schedule.minute > 59
  )
    throw new Error('Minute de rappel invalide.');
}

export function formatReminderTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
