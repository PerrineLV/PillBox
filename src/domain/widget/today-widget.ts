import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import type { PlannedIntakeReminder } from '@/domain/reminders/intake-reminder';

export type TodayWidgetSlot = Readonly<{
  scheduledAt: string;
  medicationCount: number;
  state: 'UPCOMING' | 'DUE' | 'VALIDATED';
  target: string;
}>;

export type TodayWidgetSnapshot = Readonly<{
  generatedAt: string;
  preparationAction: boolean;
  slots: readonly TodayWidgetSlot[];
}>;

/** Projection d'affichage : le widget natif ne recalcule jamais de posologie. */
export function buildTodayWidgetSnapshot(
  reminders: readonly PlannedIntakeReminder[],
  records: readonly IntakeRecord[],
  now: Date,
  preparationAction: boolean,
  targetForGroups: (groups: PlannedIntakeReminder['groups']) => string,
): TodayWidgetSnapshot {
  return {
    generatedAt: now.toISOString(),
    preparationAction,
    slots: reminders.map((reminder) => {
      const expected = reminder.treatmentIds.length;
      const groupRecords = records.filter((record) =>
        reminder.groups.some(
          (group) => group.date === record.date && group.slot === record.slot,
        ),
      );
      const validated =
        groupRecords.length === expected &&
        groupRecords.every((record) => record.status !== 'UNSET');
      return {
        scheduledAt: reminder.scheduledAt.toISOString(),
        medicationCount: expected,
        state: validated
          ? 'VALIDATED'
          : reminder.scheduledAt <= now
            ? 'DUE'
            : 'UPCOMING',
        target: targetForGroups(reminder.groups),
      };
    }),
  };
}
