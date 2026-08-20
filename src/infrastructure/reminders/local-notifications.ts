import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  INTAKE_ACTION_CATEGORIES,
  intakeActionCategory,
  notificationCommand,
  OPEN_APP_ACTION,
  type NotificationCommand,
} from '@/domain/reminders/notification-actions';
import {
  INTAKE_REMINDER_KIND,
  notificationTarget,
  PENDING_COMPLETION_REMINDER_KIND,
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
const ANDROID_PENDING_COMPLETION_CHANNEL_ID =
  'pillbox-pending-completion-reminders';

const APP_TITLE = 'PillBox';

export const PREPARATION_REMINDER_CONTENT = {
  title: APP_TITLE,
  body: 'Vous avez un pilulier à remplir.',
} as const;

/**
 * Contenu du rappel dédié au complément d'une case « en attente de
 * complément » (ticket 30b) : ne nomme jamais un médicament, une posologie,
 * un lot ni une quantité de stock, comme les autres notifications de PillBox.
 */
export const PENDING_COMPLETION_REMINDER_CONTENT = {
  title: APP_TITLE,
  body: 'Un complément de pilulier est peut-être possible.',
} as const;

/**
 * Contenu d’un rappel de prise : informe du nombre de médicaments en attente
 * sans jamais nommer un médicament, une posologie ou un lot.
 */
export function intakeReminderContent(pendingCount: number): {
  title: string;
  body: string;
} {
  return {
    title: APP_TITLE,
    body: `Vous avez ${pendingCount} médicament${pendingCount > 1 ? 's' : ''} à prendre.`,
  };
}

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
      ...intakeReminderContent(pendingCount),
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
 * Manière dont une réponse demande l’ouverture de PillBox, ou `null` lorsqu’elle
 * ne la demande pas.
 *
 * La distinction compte pour la suite : Android retire lui-même la notification
 * touchée en son corps (`autoDismiss`), mais laisse affichée celle dont on
 * presse un bouton.
 */
export type NotificationOpening = 'tap' | 'action-button';

export function notificationOpening(
  response: Notifications.NotificationResponse,
): NotificationOpening | null {
  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER)
    return 'tap';
  return response.actionIdentifier === OPEN_APP_ACTION ? 'action-button' : null;
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

/**
 * Retire du tiroir Android la notification qui a produit cette réponse.
 *
 * Une action rapide ne passe pas l’application au premier plan : sans ce
 * retrait, la notification resterait affichée avec son bouton actif après une
 * prise déjà enregistrée. L’identifiant est celui de la demande de notification,
 * qu’Android réutilise pour la notification affichée.
 */
export async function dismissRespondedNotification(
  response: Notifications.NotificationResponse,
): Promise<void> {
  await Notifications.dismissNotificationAsync(
    response.notification.request.identifier,
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
      ...intakeReminderContent(pendingCount),
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
  categoryIdentifier: string;
} {
  return { categoryIdentifier: intakeActionCategory(pendingCount) };
}

/**
 * Déclare les catégories d’action, une par combinaison de boutons possible.
 *
 * `opensAppToForeground` porte la différence entre les deux gestes : à `false`,
 * Android délivre la réponse au code JavaScript sans passer l’application au
 * premier plan, ce qui permet de valider une prise depuis le tiroir ; à `true`,
 * il ouvre ou réactive PillBox, comme un appui sur le corps de la notification.
 * Le périmètre est Android uniquement, comme les canaux de notification.
 */
async function ensureIntakeActionCategories(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    INTAKE_ACTION_CATEGORIES.map((category) =>
      Notifications.setNotificationCategoryAsync(
        category.identifier,
        category.buttons.map((button) => ({
          identifier: button.identifier,
          buttonTitle: button.buttonTitle,
          options: { opensAppToForeground: button.opensApp },
        })),
      ),
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
      ...PREPARATION_REMINDER_CONTENT,
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

/**
 * Rappel ponctuel (déclenchement unique), distinct du rappel hebdomadaire de
 * préparation et des rappels quotidiens de prise : planifié uniquement quand
 * une case reste « en attente de complément » après validation (ticket 30b).
 * Transporte la préparation et le médicament concernés (ticket 41) afin que
 * l'appui sur la notification ouvre directement l'écran de complément exact.
 */
export async function schedulePendingCompletionReminder(
  scheduledAt: Date,
  preparationId: number,
  specialtyCis: string,
): Promise<string> {
  await ensureAndroidPendingCompletionChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      ...PENDING_COMPLETION_REMINDER_CONTENT,
      data: {
        kind: PENDING_COMPLETION_REMINDER_KIND,
        preparationId,
        specialtyCis,
      },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: scheduledAt,
      channelId: ANDROID_PENDING_COMPLETION_CHANNEL_ID,
    },
  });
}

export async function cancelPendingCompletionReminderNotification(
  notificationId: string,
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

async function ensureAndroidPendingCompletionChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(
    ANDROID_PENDING_COMPLETION_CHANNEL_ID,
    {
      name: 'Complément de pilulier',
      description:
        'Rappel local ponctuel qu’un complément de pilulier est possible',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    },
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
