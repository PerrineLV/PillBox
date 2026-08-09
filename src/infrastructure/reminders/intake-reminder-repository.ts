import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  SlotTime,
  TreatmentReminderSettings,
} from '@/domain/reminders/intake-reminder';
import type { IntakeSlot } from '@/domain/treatments/treatment';

type Row = {
  treatment_id: number;
  enabled: number;
  morning_hour: number | null;
  morning_minute: number | null;
  noon_hour: number | null;
  noon_minute: number | null;
  evening_hour: number | null;
  evening_minute: number | null;
  bedtime_hour: number | null;
  bedtime_minute: number | null;
};

type GlobalSlotRow = {
  morning_hour: number;
  morning_minute: number;
  noon_hour: number;
  noon_minute: number;
  evening_hour: number;
  evening_minute: number;
  bedtime_hour: number;
  bedtime_minute: number;
};

export type GlobalIntakeReminderSettings = Record<IntakeSlot, SlotTime>;

export async function getGlobalIntakeReminderSettings(
  database: SQLiteDatabase,
): Promise<GlobalIntakeReminderSettings> {
  const row = await database.getFirstAsync<GlobalSlotRow>(
    'SELECT * FROM intake_reminder_slot_settings WHERE singleton_id = 1',
  );
  if (!row) throw new Error('Réglages horaires des prises introuvables.');
  return {
    morning: { hour: row.morning_hour, minute: row.morning_minute },
    noon: { hour: row.noon_hour, minute: row.noon_minute },
    evening: { hour: row.evening_hour, minute: row.evening_minute },
    bedtime: { hour: row.bedtime_hour, minute: row.bedtime_minute },
  };
}

export async function saveGlobalIntakeReminderSettings(
  database: SQLiteDatabase,
  value: GlobalIntakeReminderSettings,
): Promise<void> {
  await database.runAsync(
    `UPDATE intake_reminder_slot_settings SET morning_hour = ?, morning_minute = ?,
     noon_hour = ?, noon_minute = ?, evening_hour = ?, evening_minute = ?,
     bedtime_hour = ?, bedtime_minute = ?, updated_at = CURRENT_TIMESTAMP
     WHERE singleton_id = 1`,
    value.morning.hour,
    value.morning.minute,
    value.noon.hour,
    value.noon.minute,
    value.evening.hour,
    value.evening.minute,
    value.bedtime.hour,
    value.bedtime.minute,
  );
}

export async function listTreatmentReminderSettings(
  database: SQLiteDatabase,
): Promise<TreatmentReminderSettings[]> {
  const global = await getGlobalIntakeReminderSettings(database);
  const rows = await database.getAllAsync<Row>(
    'SELECT * FROM treatment_reminder_settings',
  );
  return rows.map((row) => ({ ...toSettings(row), slotTimes: global }));
}

export async function getTreatmentReminderSettings(
  database: SQLiteDatabase,
  treatmentId: number,
): Promise<TreatmentReminderSettings> {
  const [row, global] = await Promise.all([
    database.getFirstAsync<Row>(
      'SELECT * FROM treatment_reminder_settings WHERE treatment_id = ?',
      treatmentId,
    ),
    getGlobalIntakeReminderSettings(database),
  ]);
  return row
    ? { ...toSettings(row), slotTimes: global }
    : { treatmentId, enabled: false, slotTimes: global };
}

export async function saveTreatmentReminderSettings(
  database: SQLiteDatabase,
  value: TreatmentReminderSettings,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO treatment_reminder_settings
     (treatment_id, enabled, morning_hour, morning_minute, noon_hour, noon_minute,
      evening_hour, evening_minute, bedtime_hour, bedtime_minute)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(treatment_id) DO UPDATE SET enabled = excluded.enabled,
      morning_hour = excluded.morning_hour, morning_minute = excluded.morning_minute,
      noon_hour = excluded.noon_hour, noon_minute = excluded.noon_minute,
      evening_hour = excluded.evening_hour, evening_minute = excluded.evening_minute,
      bedtime_hour = excluded.bedtime_hour, bedtime_minute = excluded.bedtime_minute,
      updated_at = CURRENT_TIMESTAMP`,
    value.treatmentId,
    value.enabled ? 1 : 0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  );
}

export async function replaceScheduledReminderManifest(
  database: SQLiteDatabase,
  reminders: readonly {
    notificationId: string;
    scheduledAt: string;
    treatmentIds: readonly number[];
  }[],
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'DELETE FROM scheduled_intake_reminder_treatments',
    );
    await transaction.runAsync('DELETE FROM scheduled_intake_reminders');
    for (const reminder of reminders) {
      await transaction.runAsync(
        'INSERT INTO scheduled_intake_reminders (notification_id, scheduled_at) VALUES (?, ?)',
        reminder.notificationId,
        reminder.scheduledAt,
      );
      for (const treatmentId of reminder.treatmentIds)
        await transaction.runAsync(
          'INSERT INTO scheduled_intake_reminder_treatments (notification_id, treatment_id) VALUES (?, ?)',
          reminder.notificationId,
          treatmentId,
        );
    }
  });
}

export type ScheduledReminderManifestItem = {
  notificationId: string;
  scheduledAt: string;
  treatmentIds: number[];
};
export async function listScheduledReminderManifest(
  database: SQLiteDatabase,
): Promise<ScheduledReminderManifestItem[]> {
  const rows = await database.getAllAsync<{
    notification_id: string;
    scheduled_at: string;
    treatment_id: number | null;
  }>(
    `SELECT reminder.notification_id, reminder.scheduled_at, link.treatment_id
     FROM scheduled_intake_reminders reminder
     LEFT JOIN scheduled_intake_reminder_treatments link ON link.notification_id = reminder.notification_id
     ORDER BY reminder.scheduled_at, link.treatment_id`,
  );
  const grouped = new Map<string, ScheduledReminderManifestItem>();
  for (const row of rows) {
    const item = grouped.get(row.notification_id) ?? {
      notificationId: row.notification_id,
      scheduledAt: row.scheduled_at,
      treatmentIds: [],
    };
    if (row.treatment_id !== null) item.treatmentIds.push(row.treatment_id);
    grouped.set(row.notification_id, item);
  }
  return [...grouped.values()];
}

function toSettings(row: Row): TreatmentReminderSettings {
  const slotTimes: Partial<Record<IntakeSlot, SlotTime>> = {};
  for (const slot of ['morning', 'noon', 'evening', 'bedtime'] as const) {
    const hour = row[`${slot}_hour`];
    const minute = row[`${slot}_minute`];
    if (hour !== null && minute !== null) slotTimes[slot] = { hour, minute };
  }
  return {
    treatmentId: row.treatment_id,
    enabled: row.enabled === 1,
    slotTimes,
  };
}
