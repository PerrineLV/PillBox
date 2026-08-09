import type { SQLiteDatabase } from 'expo-sqlite';

import {
  INTAKE_REMINDER_HORIZON_DAYS,
  planIntakeReminders,
} from '@/domain/reminders/intake-reminder';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  cancelIntakeReminders,
  cancelScheduledNotifications,
  getLocalNotificationPermission,
  scheduleIntakeReminder,
} from './local-notifications';
import {
  listScheduledReminderManifest,
  listTreatmentReminderSettings,
  replaceScheduledReminderManifest,
} from './intake-reminder-repository';

export async function synchronizeIntakeReminders(
  database: SQLiteDatabase,
  now = new Date(),
): Promise<number> {
  await cancelIntakeReminders();
  await replaceScheduledReminderManifest(database, []);
  if ((await getLocalNotificationPermission()) !== 'granted') return 0;
  const until = new Date(now);
  until.setDate(until.getDate() + INTAKE_REMINDER_HORIZON_DAYS);
  const planned = planIntakeReminders(
    await listTreatments(database),
    await listTreatmentReminderSettings(database),
    now,
    until,
  );
  const manifest: {
    notificationId: string;
    scheduledAt: string;
    treatmentIds: readonly number[];
  }[] = [];
  try {
    for (const reminder of planned) {
      manifest.push({
        notificationId: await scheduleIntakeReminder(reminder.scheduledAt),
        scheduledAt: reminder.scheduledAt.toISOString(),
        treatmentIds: reminder.treatmentIds,
      });
    }
    await replaceScheduledReminderManifest(database, manifest);
    return manifest.length;
  } catch (error) {
    await cancelIntakeReminders();
    await replaceScheduledReminderManifest(database, []);
    throw error;
  }
}

/** Reprogramme uniquement les instants auxquels le traitement participe avant ou après sa modification. */
export async function synchronizeTreatmentIntakeReminders(
  database: SQLiteDatabase,
  treatmentId: number,
  now = new Date(),
): Promise<number> {
  const existing = await listScheduledReminderManifest(database);
  if ((await getLocalNotificationPermission()) !== 'granted') {
    const affected = existing.filter((item) =>
      item.treatmentIds.includes(treatmentId),
    );
    await cancelScheduledNotifications(
      affected.map((item) => item.notificationId),
    );
    await replaceScheduledReminderManifest(
      database,
      existing.filter((item) => !affected.includes(item)),
    );
    return 0;
  }
  const until = new Date(now);
  until.setDate(until.getDate() + INTAKE_REMINDER_HORIZON_DAYS);
  const desired = planIntakeReminders(
    await listTreatments(database),
    await listTreatmentReminderSettings(database),
    now,
    until,
  );
  const affectedTimes = new Set<string>();
  for (const item of existing)
    if (item.treatmentIds.includes(treatmentId))
      affectedTimes.add(item.scheduledAt);
  for (const item of desired)
    if (item.treatmentIds.includes(treatmentId))
      affectedTimes.add(item.scheduledAt.toISOString());
  const removed = existing.filter((item) =>
    affectedTimes.has(item.scheduledAt),
  );
  await cancelScheduledNotifications(
    removed.map((item) => item.notificationId),
  );
  const manifest = existing.filter(
    (item) => !affectedTimes.has(item.scheduledAt),
  );
  for (const reminder of desired.filter((item) =>
    affectedTimes.has(item.scheduledAt.toISOString()),
  ))
    manifest.push({
      notificationId: await scheduleIntakeReminder(reminder.scheduledAt),
      scheduledAt: reminder.scheduledAt.toISOString(),
      treatmentIds: reminder.treatmentIds,
    });
  await replaceScheduledReminderManifest(database, manifest);
  return manifest.length;
}
