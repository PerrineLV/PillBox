import type { SQLiteDatabase } from 'expo-sqlite';

import {
  PENDING_COMPLETION_REMINDER_HOUR,
  PENDING_COMPLETION_REMINDER_MINUTE,
  pendingCompletionReminderDate,
} from '@/domain/reminders/pending-completion-reminder';

import {
  cancelPendingCompletionReminderNotification,
  getLocalNotificationPermission,
  schedulePendingCompletionReminder,
} from './local-notifications';

/**
 * Planifie le rappel dédié pour une case laissée « en attente de complément »
 * (ticket 30b) après une validation partielle. Remplace silencieusement un
 * rappel déjà programmé pour ce même (préparation, médicament) : une
 * validation ne peut avoir lieu qu'une fois (ticket 09), mais un complément
 * ultérieur partiel doit pouvoir reprogrammer un rappel pour le reliquat.
 * Sans permission de notification accordée, ne programme rien plutôt que
 * d'échouer : la case reste visible dans l'historique.
 */
export async function schedulePendingCompletionReminderFor(
  database: SQLiteDatabase,
  preparationId: number,
  specialtyCis: string,
  theoreticalRenewalDate: string | null,
  validationDate: string,
): Promise<void> {
  await cancelPendingCompletionReminderFor(
    database,
    preparationId,
    specialtyCis,
  );
  if ((await getLocalNotificationPermission()) !== 'granted') return;
  const date = pendingCompletionReminderDate(
    theoreticalRenewalDate,
    validationDate,
  );
  const [year, month, day] = date.split('-').map(Number);
  const scheduledAt = new Date(
    year,
    month - 1,
    day,
    PENDING_COMPLETION_REMINDER_HOUR,
    PENDING_COMPLETION_REMINDER_MINUTE,
    0,
    0,
  );
  const notificationId = await schedulePendingCompletionReminder(
    scheduledAt,
    preparationId,
    specialtyCis,
  );
  await database.runAsync(
    `INSERT INTO pending_completion_reminders
      (preparation_id, specialty_cis, notification_id, scheduled_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(preparation_id, specialty_cis) DO UPDATE SET
       notification_id = excluded.notification_id,
       scheduled_at = excluded.scheduled_at`,
    preparationId,
    specialtyCis,
    notificationId,
    scheduledAt.toISOString(),
  );
}

/**
 * Annule et efface le rappel dédié d'un (préparation, médicament) — par
 * exemple une fois la case entièrement résolue (ticket 30b) — sans effet
 * s'il n'y en a aucun.
 */
export async function cancelPendingCompletionReminderFor(
  database: SQLiteDatabase,
  preparationId: number,
  specialtyCis: string,
): Promise<void> {
  const row = await database.getFirstAsync<{ notification_id: string }>(
    `SELECT notification_id FROM pending_completion_reminders
     WHERE preparation_id = ? AND specialty_cis = ?`,
    preparationId,
    specialtyCis,
  );
  if (row !== null) {
    await cancelPendingCompletionReminderNotification(row.notification_id);
  }
  await database.runAsync(
    `DELETE FROM pending_completion_reminders
     WHERE preparation_id = ? AND specialty_cis = ?`,
    preparationId,
    specialtyCis,
  );
}
