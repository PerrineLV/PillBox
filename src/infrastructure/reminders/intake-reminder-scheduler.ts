import type { SQLiteDatabase } from 'expo-sqlite';

import {
  INTAKE_REMINDER_HORIZON_DAYS,
  localCivilDate,
  planIntakeReminders,
  type PlannedIntakeReminder,
} from '@/domain/reminders/intake-reminder';
import {
  pendingIntakeCountForGroups,
  snapshotGeneratedIntake,
} from '@/domain/intakes/intake-tracking';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  listPendingIntakeCounts,
  materializeIntakeSnapshots,
} from '@/infrastructure/intakes/intake-repository';
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

/**
 * Recalcule l’intégralité des rappels de prise.
 *
 * L’ordre des vérifications est une règle de sûreté : rien n’est supprimé avant
 * de savoir que la suppression est voulue. Seule une désactivation explicite
 * efface la programmation. Une permission Android retirée laisse les alarmes en
 * place : elles ne peuvent pas être affichées tant que la permission manque,
 * mais elles redeviennent utiles dès qu’elle est rendue, alors qu’une
 * suppression silencieuse serait irrécupérable sans action de l’utilisatrice.
 */
export async function synchronizeIntakeReminders(
  database: SQLiteDatabase,
  now = new Date(),
): Promise<number> {
  if (!(await isIntakeRemindersEnabled(database))) {
    await cancelIntakeReminders();
    await replaceScheduledReminderManifest(database, []);
    return 0;
  }
  if ((await getLocalNotificationPermission()) !== 'granted') {
    return (await listScheduledReminderManifest(database)).length;
  }
  await cancelIntakeReminders();
  await replaceScheduledReminderManifest(database, []);
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
  const pending = await listPendingIntakeCounts(
    database,
    localCivilDate(now),
    localCivilDate(until),
  );
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
          pendingIntakeCountForGroups(pending, reminder.groups),
          ...(reminderNeedsBoxSelection(reminder, treatments) ? [true] : []),
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
  // Même règle que la synchronisation complète : une permission manquante ne
  // justifie pas de détruire une programmation encore récupérable. Le prochain
  // passage au premier plan avec la permission rendue recalculera tout.
  if ((await getLocalNotificationPermission()) !== 'granted') {
    return existing.length;
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
  const pending = await listPendingIntakeCounts(
    database,
    localCivilDate(now),
    localCivilDate(until),
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
      notificationId: await scheduleIntakeReminder(
        reminder.scheduledAt,
        reminder.groups,
        pendingIntakeCountForGroups(pending, reminder.groups),
        ...(reminderNeedsBoxSelection(reminder, treatments) ? [true] : []),
      ),
      scheduledAt: reminder.scheduledAt.toISOString(),
      treatmentIds: reminder.treatmentIds,
    });
  await replaceScheduledReminderManifest(database, manifest);
  return manifest.length;
}

function reminderNeedsBoxSelection(
  reminder: PlannedIntakeReminder,
  treatments: readonly Treatment[],
): boolean {
  const byId = new Map(
    treatments.map((treatment) => [treatment.id, treatment]),
  );
  return reminder.treatmentIds.some((id) => {
    const treatment = byId.get(id);
    return (
      treatment?.dosageKind === 'SCHEDULED' && !treatment.includedInPillbox
    );
  });
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
