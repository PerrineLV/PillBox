import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  assertValidReminderSchedule,
  expoWeekday,
  type PreparationReminderSchedule,
} from '@/domain/reminders/preparation-reminder';

export const PREPARATION_ROUTE = '/preparations/new' as const;
const REMINDER_KIND = 'pillbox-preparation-reminder';
const ANDROID_CHANNEL_ID = 'pillbox-preparation-reminders';

export type LocalNotificationPermission = 'granted' | 'denied';

export async function getLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted ? 'granted' : 'denied';
}

export async function requestLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  await ensureAndroidChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted ? 'granted' : 'denied';
}

export async function replacePreparationReminder(
  schedule: PreparationReminderSchedule,
): Promise<string> {
  assertValidReminderSchedule(schedule);
  await cancelPreparationReminders();
  await ensureAndroidChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Préparer mon pilulier',
      body: 'C’est le moment de préparer votre pilulier pour la semaine.',
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
    sound: 'default',
  });
}
