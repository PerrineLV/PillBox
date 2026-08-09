import * as Notifications from 'expo-notifications';
import { router, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DatabaseProvider } from '@/infrastructure/database/database-provider';
import { AppLockGate } from '@/components/privacy/app-lock-gate';
import { BottomNavigation, colors, typography } from '@/ui';
import {
  isPreparationReminder,
  intakeReminderDate,
  intakeReminderGroups,
  postponedIntakeGroup,
  PREPARATION_ROUTE,
} from '@/infrastructure/reminders/local-notifications';
import { synchronizeIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { reconcileIntakePostponements } from '@/infrastructure/intakes/intake-postponement-service';

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
  const pathname = usePathname();
  const rootScreen = ['/', '/treatments', '/inventory', '/more'].includes(
    pathname,
  );
  return (
    <DatabaseProvider>
      <ReminderCoordinator />
      <AppLockGate>
        <View style={{ flex: 1 }}>
          <SafeAreaView
            edges={rootScreen ? ['top'] : []}
            style={styles.navigationContent}
          >
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: colors.background },
                headerBackButtonDisplayMode: 'minimal',
                headerShadowVisible: false,
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.brand,
                headerTitleStyle: typography.heading,
                headerShown: false,
              }}
            />
          </SafeAreaView>
          <BottomNavigation />
        </View>
      </AppLockGate>
    </DatabaseProvider>
  );
}

const styles = {
  navigationContent: { flex: 1 },
} as const;

function ReminderCoordinator() {
  const database = useSQLiteContext();
  useEffect(() => {
    const synchronize = () => {
      void Promise.all([
        synchronizeIntakeReminders(database),
        reconcileIntakePostponements(database),
      ]).catch(() => {
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
        const groups = intakeReminderGroups(notification);
        router.push({
          pathname: '/intakes/planned',
          params: {
            at: scheduledAt,
            groups: groups
              .map((group) => `${group.date}:${group.slot}`)
              .join(','),
          },
        });
        Notifications.clearLastNotificationResponse();
        return;
      }
      const postponed = postponedIntakeGroup(notification);
      if (postponed !== null) {
        router.push({
          pathname: '/intakes/planned',
          params: { date: postponed.date, slot: postponed.slot },
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
