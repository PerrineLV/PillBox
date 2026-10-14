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
  const pending = await countPendingIntakes(database, date, slot);
  if (pending === 0)
    throw new Error('Aucune prise applicable à reporter pour ce créneau.');
  const previous = await getIntakePostponement(database, date, slot);
  const notificationId = await schedulePostponedIntakeReminder(
    scheduledAt,
    date,
    slot,
    pending,
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
  refreshExisting = false,
): Promise<void> {
  const values = await listIntakePostponements(database);
  for (const value of values) {
    if (new Date(value.scheduledAt) <= now) continue;
    const pending = await countPendingIntakes(database, value.date, value.slot);
    if (pending === 0) {
      await cancelIntakePostponement(database, value.date, value.slot);
      continue;
    }
    if (value.notificationId !== null && !refreshExisting) continue;
    const notificationId = await schedulePostponedIntakeReminder(
      new Date(value.scheduledAt),
      value.date,
      value.slot,
      pending,
    );
    try {
      await saveIntakePostponement(database, { ...value, notificationId });
    } catch (error) {
      await cancelScheduledNotifications([notificationId]);
      throw error;
    }
    if (value.notificationId !== null)
      await cancelScheduledNotifications([value.notificationId]);
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
