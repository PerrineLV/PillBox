import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  INTAKE_ACTION_CATEGORIES,
  intakeActionCategory,
  notificationCommand,
  VALIDATE_INTAKES_ACTION,
  type NotificationCommand,
} from '@/domain/reminders/notification-actions';
import {
  INTAKE_REMINDER_KIND,
  notificationTarget,
  POSTPONED_INTAKE_KIND,
  PREPARATION_REMINDER_KIND,
  PREPARATION_ROUTE,
  serializeIntakeGroups,
  type NotificationTarget,
} from '@/domain/reminders/notification-navigation';
import {
  assertValidReminderSchedule,
  expoWeekday,
  type PreparationReminderSchedule,
} from '@/domain/reminders/preparation-reminder';
import type { IntakeSlot } from '@/domain/treatments/treatment';

const ANDROID_CHANNEL_ID = 'pillbox-preparation-reminders';
const ANDROID_INTAKE_CHANNEL_ID = 'pillbox-intake-reminders';

export const NEUTRAL_REMINDER_CONTENT = {
  title: 'Rappel PillBox',
  body: 'Une action planifiée vous attend dans l’application.',
} as const;

export type LocalNotificationPermission = 'granted' | 'denied' | 'blocked';

export async function getLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted
    ? 'granted'
    : permission.canAskAgain
      ? 'denied'
      : 'blocked';
}

export async function requestLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  await ensureAndroidChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted
    ? 'granted'
    : requested.canAskAgain
      ? 'denied'
      : 'blocked';
}

export async function scheduleIntakeReminder(
  scheduledAt: Date,
  groups: readonly { date: string; slot: IntakeSlot }[],
  pendingCount: number,
): Promise<string> {
  await ensureAndroidIntakeChannel();
  await ensureIntakeActionCategories();
  return Notifications.scheduleNotificationAsync({
    content: {
      ...NEUTRAL_REMINDER_CONTENT,
      ...intakeActionCategoryContent(pendingCount),
      data: {
        kind: INTAKE_REMINDER_KIND,
        scheduledAt: scheduledAt.toISOString(),
        groups: serializeIntakeGroups(groups),
      },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: scheduledAt,
      channelId: ANDROID_INTAKE_CHANNEL_ID,
    },
  });
}

/** Écran à ouvrir pour la notification touchée, ou `null` si elle n’est pas la nôtre. */
export function notificationTargetOf(
  notification: Notifications.Notification,
): NotificationTarget | null {
  return notificationTarget(notification.request.content.data);
}

/**
 * Vrai lorsque la notification a été touchée normalement, et non via un bouton
 * d’action : seul cet appui ouvre l’application.
 */
export function isDefaultNotificationTap(
  response: Notifications.NotificationResponse,
): boolean {
  return response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;
}

/** Commande demandée par un bouton d’action, ou `null` pour toute autre réponse. */
export function notificationCommandOf(
  response: Notifications.NotificationResponse,
): NotificationCommand | null {
  return notificationCommand(
    response.actionIdentifier,
    response.notification.request.content.data,
  );
}

export async function schedulePostponedIntakeReminder(
  scheduledAt: Date,
  date: string,
  slot: IntakeSlot,
  pendingCount: number,
): Promise<string> {
  await ensureAndroidIntakeChannel();
  await ensureIntakeActionCategories();
  return Notifications.scheduleNotificationAsync({
    content: {
      ...NEUTRAL_REMINDER_CONTENT,
      ...intakeActionCategoryContent(pendingCount),
      data: { kind: POSTPONED_INTAKE_KIND, date, slot },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: scheduledAt,
      channelId: ANDROID_INTAKE_CHANNEL_ID,
    },
  });
}

function intakeActionCategoryContent(pendingCount: number): {
  categoryIdentifier?: string;
} {
  const categoryIdentifier = intakeActionCategory(pendingCount);
  return categoryIdentifier === null ? {} : { categoryIdentifier };
}

/**
 * Déclare les deux catégories d’action, une par libellé possible.
 *
 * `opensAppToForeground: false` est le cœur du comportement attendu : Android
 * délivre la réponse au code JavaScript sans passer l’application au premier
 * plan, y compris lorsqu’elle est en arrière-plan. Le périmètre est Android
 * uniquement, comme les canaux de notification.
 */
async function ensureIntakeActionCategories(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    INTAKE_ACTION_CATEGORIES.map((category) =>
      Notifications.setNotificationCategoryAsync(category.identifier, [
        {
          identifier: VALIDATE_INTAKES_ACTION,
          buttonTitle: category.buttonTitle,
          options: { opensAppToForeground: false },
        },
      ]),
    ),
  );
}

export async function cancelIntakeReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.content.data?.kind === INTAKE_REMINDER_KIND)
      .map((item) =>
        Notifications.cancelScheduledNotificationAsync(item.identifier),
      ),
  );
}

export async function cancelPostponedIntakeReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.content.data?.kind === POSTPONED_INTAKE_KIND)
      .map((item) =>
        Notifications.cancelScheduledNotificationAsync(item.identifier),
      ),
  );
}

export async function cancelScheduledNotifications(
  identifiers: readonly string[],
): Promise<void> {
  await Promise.all(
    identifiers.map((identifier) =>
      Notifications.cancelScheduledNotificationAsync(identifier),
    ),
  );
}

export async function replacePreparationReminder(
  schedule: PreparationReminderSchedule,
): Promise<string> {
  assertValidReminderSchedule(schedule);
  await cancelPreparationReminders();
  await ensureAndroidChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      ...NEUTRAL_REMINDER_CONTENT,
      data: { kind: PREPARATION_REMINDER_KIND, url: PREPARATION_ROUTE },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: expoWeekday(schedule.weekday),
      hour: schedule.hour,
      minute: schedule.minute,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

export async function cancelPreparationReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ours = scheduled.filter(
    (request) => request.content.data?.kind === PREPARATION_REMINDER_KIND,
  );
  await Promise.all(
    ours.map((request) =>
      Notifications.cancelScheduledNotificationAsync(request.identifier),
    ),
  );
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Préparation du pilulier',
    description: 'Rappel hebdomadaire local de préparation du pilulier',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: 'default',
  });
}

async function ensureAndroidIntakeChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_INTAKE_CHANNEL_ID, {
    name: 'Rappels de prise',
    description: 'Rappels locaux et neutres des prises planifiées',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: 'default',
  });
}
