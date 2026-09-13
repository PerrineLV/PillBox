/**
 * Surface locale d'`expo-notifications` utilisée par PillBox.
 *
 * Avec Expo SDK 57 sur Android, l'entrée publique du paquet charge aussi
 * l'auto-enregistrement des notifications push. Expo Go ne fournit plus ce
 * module natif et cet effet de bord fait planter l'application dès l'import,
 * alors que les notifications locales restent officiellement compatibles.
 *
 * Ces imports ciblés évitent uniquement ce mécanisme push. À retirer lors du
 * passage à Expo SDK 58, où le crash d'import est corrigé en amont.
 */
export {
  getPermissionsAsync,
  requestPermissionsAsync,
} from 'expo-notifications/build/NotificationPermissions';
export { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
export { dismissNotificationAsync } from 'expo-notifications/build/dismissNotificationAsync';
export { getAllScheduledNotificationsAsync } from 'expo-notifications/build/getAllScheduledNotificationsAsync';
export { cancelScheduledNotificationAsync } from 'expo-notifications/build/cancelScheduledNotificationAsync';
export { setNotificationCategoryAsync } from 'expo-notifications/build/setNotificationCategoryAsync';
export { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
export { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
export {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  DEFAULT_ACTION_IDENTIFIER,
  getLastNotificationResponse,
} from 'expo-notifications/build/NotificationsEmitter';
export {
  AndroidImportance,
  AndroidNotificationVisibility,
} from 'expo-notifications/build/NotificationChannelManager.types';
export { SchedulableTriggerInputTypes } from 'expo-notifications/build/Notifications.types';

export type {
  Notification,
  NotificationResponse,
} from 'expo-notifications/build/Notifications.types';
