import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { DatabaseProvider } from '@/infrastructure/database/database-provider';
import { AppLockGate } from '@/components/privacy/app-lock-gate';
import { colors, typography } from '@/ui';
import {
  isPreparationReminder,
  intakeReminderDate,
  PREPARATION_ROUTE,
} from '@/infrastructure/reminders/local-notifications';
import { synchronizeIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  usePreparationNotificationNavigation();
  return (
    <DatabaseProvider>
      <ReminderCoordinator />
      <AppLockGate>
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.brand,
            headerTitleStyle: typography.heading,
            headerShown: false,
          }}
        />
      </AppLockGate>
    </DatabaseProvider>
  );
}

function ReminderCoordinator() {
  const database = useSQLiteContext();
  useEffect(() => {
    const synchronize = () => {
      void synchronizeIntakeReminders(database).catch(() => {
        /* L’UI de réglage signalera une erreur ; aucune donnée médicale n’est journalisée. */
      });
    };
    synchronize();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') synchronize();
    });
    return () => subscription.remove();
  }, [database]);
  return null;
}

function usePreparationNotificationNavigation(): void {
  useEffect(() => {
    function openPreparation(notification: Notifications.Notification): void {
      if (isPreparationReminder(notification)) {
        router.push(PREPARATION_ROUTE);
        Notifications.clearLastNotificationResponse();
        return;
      }
      const scheduledAt = intakeReminderDate(notification);
      if (scheduledAt !== null) {
        router.push({
          pathname: '/intakes/planned',
          params: { at: scheduledAt },
        });
        Notifications.clearLastNotificationResponse();
      }
    }

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse !== null) openPreparation(lastResponse.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => openPreparation(response.notification),
    );
    return () => subscription.remove();
  }, []);
}
