import type { SQLiteDatabase } from 'expo-sqlite';

import { pendingIntakeCountForGroups } from '@/domain/intakes/intake-tracking';
import type { IntakeSlot } from '@/domain/treatments/treatment';
import {
  deleteIntakePostponement,
  getIntakePostponement,
  listIntakePostponements,
  listPendingIntakeCounts,
  saveIntakePostponement,
} from './intake-repository';
import {
  cancelScheduledNotifications,
  getLocalNotificationPermission,
  schedulePostponedIntakeReminder,
} from '@/infrastructure/reminders/local-notifications';

export async function replaceIntakePostponement(
  database: SQLiteDatabase,
  date: string,
  slot: IntakeSlot,
  scheduledAt: Date,
): Promise<void> {
  if (scheduledAt <= new Date())
    throw new Error('Choisissez une heure future pour le report.');
  if ((await getLocalNotificationPermission()) !== 'granted')
    throw new Error('Les notifications ne sont pas autorisées.');
  const previous = await getIntakePostponement(database, date, slot);
  const notificationId = await schedulePostponedIntakeReminder(
    scheduledAt,
    date,
    slot,
    await countPendingIntakes(database, date, slot),
  );
  try {
    await saveIntakePostponement(database, {
      date,
      slot,
      scheduledAt: scheduledAt.toISOString(),
      notificationId,
    });
  } catch (error) {
    await cancelScheduledNotifications([notificationId]);
    throw error;
  }
  if (previous?.notificationId)
    await cancelScheduledNotifications([previous.notificationId]);
}

export async function cancelIntakePostponement(
  database: SQLiteDatabase,
  date: string,
  slot: IntakeSlot,
): Promise<void> {
  const previous = await getIntakePostponement(database, date, slot);
  if (previous?.notificationId)
    await cancelScheduledNotifications([previous.notificationId]);
  await deleteIntakePostponement(database, date, slot);
}

export async function reconcileIntakePostponements(
  database: SQLiteDatabase,
  now = new Date(),
): Promise<void> {
  const values = await listIntakePostponements(database);
  for (const value of values) {
    if (new Date(value.scheduledAt) <= now) continue;
    if (value.notificationId !== null) continue;
    const notificationId = await schedulePostponedIntakeReminder(
      new Date(value.scheduledAt),
      value.date,
      value.slot,
      await countPendingIntakes(database, value.date, value.slot),
    );
    await saveIntakePostponement(database, { ...value, notificationId });
  }
}

/** Prises encore en attente d'un créneau, pour choisir le libellé de l'action rapide. */
async function countPendingIntakes(
  database: SQLiteDatabase,
  date: string,
  slot: IntakeSlot,
): Promise<number> {
  return pendingIntakeCountForGroups(
    await listPendingIntakeCounts(database, date, date),
    [{ date, slot }],
  );
}
