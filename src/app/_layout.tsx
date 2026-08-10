import * as Notifications from 'expo-notifications';
import {
  router,
  Stack,
  useNavigationContainerRef,
  usePathname,
} from 'expo-router';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DatabaseProvider } from '@/infrastructure/database/database-provider';
import { AppLockGate } from '@/components/privacy/app-lock-gate';
import { BottomNavigation, colors, typography } from '@/ui';
import {
  createDeferredNotificationNavigation,
  PLANNED_INTAKE_ROUTE,
  PREPARATION_ROUTE,
  serializeIntakeGroups,
  type NotificationTarget,
} from '@/domain/reminders/notification-navigation';
import {
  isDefaultNotificationTap,
  notificationCommandOf,
  notificationTargetOf,
} from '@/infrastructure/reminders/local-notifications';
import { synchronizeIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { reconcileIntakePostponements } from '@/infrastructure/intakes/intake-postponement-service';
import { markPendingIntakesTakenForGroups } from '@/infrastructure/intakes/intake-repository';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  useNotificationNavigation();
  const pathname = usePathname();
  const rootScreen = ['/', '/treatments', '/inventory', '/more'].includes(
    pathname,
  );
  return (
    <DatabaseProvider>
      <ReminderCoordinator />
      <IntakeActionCoordinator />
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

/**
 * Exécute les actions rapides des notifications de prise.
 *
 * Le composant est monté à l’intérieur de `DatabaseProvider` mais en dehors de
 * `AppLockGate` : l’action doit aboutir sans passer l’application au premier
 * plan, donc sans authentification possible. Elle n’expose aucune donnée, elle
 * écrit seulement la confirmation demandée depuis la notification.
 *
 * L’écriture est idempotente : seules les prises encore en attente changent
 * d’état. Une réponse reçue deux fois, ou rejouée au démarrage suivant, ne crée
 * donc aucun doublon et ne réécrit pas l’heure d’une prise déjà validée.
 */
function IntakeActionCoordinator() {
  const database = useSQLiteContext();
  useEffect(() => {
    let released = false;

    function handle(response: Notifications.NotificationResponse): void {
      const command = notificationCommandOf(response);
      if (command === null) return;
      markPendingIntakesTakenForGroups(database, command.groups)
        .then(() => {
          // La réponse traitée ne doit pas être rejouée au prochain démarrage.
          if (!released) Notifications.clearLastNotificationResponse();
        })
        .catch(() => {
          // La réponse reste en attente : elle sera rejouée au démarrage
          // suivant, sans risque de doublon. Aucune donnée n’est journalisée.
        });
    }

    // Cas de l’application arrêtée : la réponse peut précéder le premier rendu.
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse !== null) handle(lastResponse);

    const responses = Notifications.addNotificationResponseReceivedListener(
      (response) => handle(response),
    );
    return () => {
      released = true;
      responses.remove();
    };
  }, [database]);
  return null;
}

function openNotificationTarget(target: NotificationTarget): void {
  switch (target.kind) {
    case 'preparation':
      router.push(PREPARATION_ROUTE);
      return;
    case 'planned-intake':
      router.push({
        pathname: PLANNED_INTAKE_ROUTE,
        params: { at: target.at, groups: serializeIntakeGroups(target.groups) },
      });
      return;
    case 'postponed-intake':
      router.push({
        pathname: PLANNED_INTAKE_ROUTE,
        params: { date: target.date, slot: target.slot },
      });
  }
}

/**
 * Ouvre l’écran correspondant à la notification touchée.
 *
 * L’appui est enregistré dès le premier rendu, mais la navigation n’a lieu
 * qu’une fois l’arbre de navigation monté. Sur un démarrage à froid déclenché
 * par une notification, la base SQLite s’ouvre encore et le verrou local peut
 * masquer le contenu : le `<Stack>` n’est pas encore rendu et Expo Router lève
 * alors une erreur fatale, ce qui empêchait l’application de s’ouvrir.
 */
function useNotificationNavigation(): void {
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    const navigation = createDeferredNotificationNavigation({
      isReady: () => navigationRef.isReady(),
      navigate: openNotificationTarget,
      acknowledge: () => Notifications.clearLastNotificationResponse(),
    });

    function handle(response: Notifications.NotificationResponse): void {
      // Un bouton d’action valide une prise sans ouvrir l’application : seul
      // l’appui standard sur la notification déclenche une navigation.
      if (!isDefaultNotificationTap(response)) return;
      const target = notificationTargetOf(response.notification);
      if (target !== null) navigation.request(target);
    }

    // Cas de l’application complètement arrêtée : la réponse est déjà connue
    // du module natif avant même le premier rendu JavaScript.
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse !== null) handle(lastResponse);

    const responses = Notifications.addNotificationResponseReceivedListener(
      (response) => handle(response),
    );
    const unsubscribeReady = navigationRef.addListener('ready', () =>
      navigation.flush(),
    );
    const unsubscribeState = navigationRef.addListener('state', () =>
      navigation.flush(),
    );
    return () => {
      responses.remove();
      unsubscribeReady();
      unsubscribeState();
    };
  }, [navigationRef]);
}
