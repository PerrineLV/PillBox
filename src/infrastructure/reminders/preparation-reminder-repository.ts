import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  PreparationReminderSchedule,
  PreparationReminderSettings,
} from '@/domain/reminders/preparation-reminder';

type ReminderRow = {
  enabled: number;
  weekday: PreparationReminderSettings['weekday'];
  hour: number;
  minute: number;
  notification_id: string | null;
};

export async function getPreparationReminderSettings(
  database: SQLiteDatabase,
): Promise<PreparationReminderSettings> {
  const row = await database.getFirstAsync<ReminderRow>(
    `SELECT enabled, weekday, hour, minute, notification_id
     FROM preparation_reminder_settings WHERE singleton_id = 1`,
  );
  if (row === null) throw new Error('Réglage du rappel local introuvable.');
  return {
    enabled: row.enabled === 1,
    weekday: row.weekday,
    hour: row.hour,
    minute: row.minute,
    notificationId: row.notification_id,
  };
}

export async function savePreparationReminderSettings(
  database: SQLiteDatabase,
  schedule: PreparationReminderSchedule,
  notificationId: string | null,
): Promise<void> {
  await database.runAsync(
    `UPDATE preparation_reminder_settings
     SET enabled = ?, weekday = ?, hour = ?, minute = ?, notification_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE singleton_id = 1`,
    notificationId === null ? 0 : 1,
    schedule.weekday,
    schedule.hour,
    schedule.minute,
    notificationId,
  );
}
