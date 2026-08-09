import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';

import { DatabaseProvider } from '@/infrastructure/database/database-provider';
import {
  isPreparationReminder,
  PREPARATION_ROUTE,
} from '@/infrastructure/reminders/local-notifications';

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
      <Stack screenOptions={{ headerShown: false }} />
    </DatabaseProvider>
  );
}

function usePreparationNotificationNavigation(): void {
  useEffect(() => {
    function openPreparation(notification: Notifications.Notification): void {
      if (isPreparationReminder(notification)) {
        router.push(PREPARATION_ROUTE);
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
