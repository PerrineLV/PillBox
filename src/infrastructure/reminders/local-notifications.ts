import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  assertValidReminderSchedule,
  expoWeekday,
  type PreparationReminderSchedule,
} from '@/domain/reminders/preparation-reminder';

export const PREPARATION_ROUTE = '/preparations/new' as const;
const REMINDER_KIND = 'pillbox-preparation-reminder';
const INTAKE_REMINDER_KIND = 'pillbox-intake-reminder';
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
): Promise<string> {
  await ensureAndroidIntakeChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      ...NEUTRAL_REMINDER_CONTENT,
      data: {
        kind: INTAKE_REMINDER_KIND,
        scheduledAt: scheduledAt.toISOString(),
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

export async function cancelScheduledNotifications(
  identifiers: readonly string[],
): Promise<void> {
  await Promise.all(
    identifiers.map((identifier) =>
      Notifications.cancelScheduledNotificationAsync(identifier),
    ),
  );
}

export function intakeReminderDate(
  notification: Notifications.Notification,
): string | null {
  const data = notification.request.content.data;
  return data?.kind === INTAKE_REMINDER_KIND &&
    typeof data.scheduledAt === 'string'
    ? data.scheduledAt
    : null;
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
      data: { kind: REMINDER_KIND, url: PREPARATION_ROUTE },
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
    (request) => request.content.data?.kind === REMINDER_KIND,
  );
  await Promise.all(
    ours.map((request) =>
      Notifications.cancelScheduledNotificationAsync(request.identifier),
    ),
  );
}

export function isPreparationReminder(
  notification: Notifications.Notification,
): boolean {
  return (
    notification.request.content.data?.kind === REMINDER_KIND &&
    notification.request.content.data?.url === PREPARATION_ROUTE
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
