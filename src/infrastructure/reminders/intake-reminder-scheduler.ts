import type { SQLiteDatabase } from 'expo-sqlite';

import {
  INTAKE_REMINDER_HORIZON_DAYS,
  localCivilDate,
  planIntakeReminders,
  type PlannedIntakeReminder,
} from '@/domain/reminders/intake-reminder';
import { snapshotGeneratedIntake } from '@/domain/intakes/intake-tracking';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import type { Treatment } from '@/domain/treatments/treatment';
import { materializeIntakeSnapshots } from '@/infrastructure/intakes/intake-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  cancelIntakeReminders,
  cancelScheduledNotifications,
  getLocalNotificationPermission,
  scheduleIntakeReminder,
} from './local-notifications';
import {
  getGlobalIntakeReminderSettings,
  isIntakeRemindersEnabled,
  listScheduledReminderManifest,
  replaceScheduledReminderManifest,
} from './intake-reminder-repository';

export async function synchronizeIntakeReminders(
  database: SQLiteDatabase,
  now = new Date(),
): Promise<number> {
  await cancelIntakeReminders();
  await replaceScheduledReminderManifest(database, []);
  if (!(await isIntakeRemindersEnabled(database))) return 0;
  if ((await getLocalNotificationPermission()) !== 'granted') return 0;
  const until = new Date(now);
  until.setDate(until.getDate() + INTAKE_REMINDER_HORIZON_DAYS);
  const treatments = await listTreatments(database);
  const planned = planIntakeReminders(
    treatments,
    await getGlobalIntakeReminderSettings(database),
    now,
    until,
  );
  await materializePlannedIntakes(database, treatments, planned, now, until);
  const manifest: {
    notificationId: string;
    scheduledAt: string;
    treatmentIds: readonly number[];
  }[] = [];
  try {
    for (const reminder of planned) {
      manifest.push({
        notificationId: await scheduleIntakeReminder(
          reminder.scheduledAt,
          reminder.groups,
        ),
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
  if (!(await isIntakeRemindersEnabled(database))) {
    await cancelScheduledNotifications(
      existing.map((item) => item.notificationId),
    );
    await replaceScheduledReminderManifest(database, []);
    return 0;
  }
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
  const treatments = await listTreatments(database);
  const desired = planIntakeReminders(
    treatments,
    await getGlobalIntakeReminderSettings(database),
    now,
    until,
  );
  await materializePlannedIntakes(database, treatments, desired, now, until);
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
      notificationId: await scheduleIntakeReminder(
        reminder.scheduledAt,
        reminder.groups,
      ),
      scheduledAt: reminder.scheduledAt.toISOString(),
      treatmentIds: reminder.treatmentIds,
    });
  await replaceScheduledReminderManifest(database, manifest);
  return manifest.length;
}

async function materializePlannedIntakes(
  database: SQLiteDatabase,
  treatments: readonly Treatment[],
  planned: readonly PlannedIntakeReminder[],
  from: Date,
  until: Date,
): Promise<void> {
  const expected = new Set<string>();
  for (const reminder of planned)
    for (const treatmentId of reminder.treatmentIds)
      for (const group of reminder.groups)
        expected.add(`${treatmentId}:${group.date}:${group.slot}`);
  const treatmentById = new Map(treatments.map((item) => [item.id, item]));
  const intakes = generateIntakes(
    treatments,
    localCivilDate(from),
    localCivilDate(until),
    { includeTreatmentsOutsidePillbox: true },
  ).filter((item) =>
    expected.has(`${item.treatmentId}:${item.date}:${item.slot}`),
  );
  await materializeIntakeSnapshots(
    database,
    intakes.map((item) =>
      snapshotGeneratedIntake(
        item,
        treatmentById.get(item.treatmentId)?.pharmaceuticalForm ?? null,
      ),
    ),
  );
}
