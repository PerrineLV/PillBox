import { NativeModules, Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { buildAttentionItems } from '@/domain/home/attention-items';
import { listIntakeRecordsForGroups } from '@/infrastructure/intakes/intake-repository';
import { listPreparationWeeks } from '@/infrastructure/preparations/preparation-repository';
import { getPreparationReminderSettings } from '@/infrastructure/reminders/preparation-reminder-repository';
import { getGlobalIntakeReminderSettings } from '@/infrastructure/reminders/intake-reminder-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { buildTodayWidgetSnapshot } from '@/domain/widget/today-widget';
import {
  localCivilDate,
  planIntakeReminders,
  startOfLocalDay,
} from '@/domain/reminders/intake-reminder';
import { serializeIntakeGroups } from '@/domain/reminders/notification-navigation';

type TodayWidgetNativeModule = { saveSnapshot(value: string): Promise<void> };

function nativeModule(): TodayWidgetNativeModule | null {
  return (
    (NativeModules.PillBoxTodayWidget as TodayWidgetNativeModule | undefined) ??
    null
  );
}

export async function refreshTodayWidget(
  database: SQLiteDatabase,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  const widget = nativeModule();
  if (widget === null) return;
  const now = new Date();
  const today = localCivilDate(now);
  const [treatments, slotTimes, reminder, weeks] = await Promise.all([
    listTreatments(database),
    getGlobalIntakeReminderSettings(database),
    getPreparationReminderSettings(database),
    listPreparationWeeks(database),
  ]);
  const start = startOfLocalDay(today);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  const planned = planIntakeReminders(treatments, slotTimes, start, end);
  const slots = [
    ...new Set(
      planned.flatMap((item) => item.groups.map((group) => group.slot)),
    ),
  ];
  const records = await listIntakeRecordsForGroups(database, today, slots);
  const attention = buildAttentionItems({
    referenceDate: today,
    now,
    intakeRemindersEnabled: false,
    preparationReminder: reminder,
    treatments: [],
    intakeSlotTimes: slotTimes,
    pendingIntakeCounts: [],
    draftPreparation: null,
    knownPreparationWeeks: weeks,
    renewalItems: [],
    expirations: [],
    asNeededTreatments: [],
    prescriptions: [],
  });
  const snapshot = buildTodayWidgetSnapshot(
    planned,
    records,
    now,
    attention.some((item) => item.type === 'PREPARATION'),
    (groups) =>
      `pillbox://intakes/planned?groups=${encodeURIComponent(serializeIntakeGroups(groups))}`,
  );
  await widget.saveSnapshot(JSON.stringify(snapshot));
}
