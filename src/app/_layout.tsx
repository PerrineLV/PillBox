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

import {
  DatabaseProvider,
  useDatabaseTaskQueue,
} from '@/infrastructure/database/database-provider';
import { AppLockGate } from '@/components/privacy/app-lock-gate';
import { BottomNavigation, colors, ToastProvider, typography } from '@/ui';
import {
  createDeferredNotificationNavigation,
  PENDING_COMPLETION_COMPLETE_ROUTE,
  PENDING_COMPLETION_ROUTE,
  PLANNED_INTAKE_ROUTE,
  PREPARATION_ROUTE,
  serializeIntakeGroups,
  type NotificationTarget,
} from '@/domain/reminders/notification-navigation';
import {
  dismissRespondedNotification,
  notificationCommandOf,
  notificationOpening,
  notificationTargetOf,
} from '@/infrastructure/reminders/local-notifications';
import { runNotificationCommand } from '@/domain/reminders/notification-actions';
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
      <ToastProvider>
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
      </ToastProvider>
    </DatabaseProvider>
  );
}

const styles = {
  navigationContent: { flex: 1 },
} as const;

function ReminderCoordinator() {
  const database = useSQLiteContext();
  const queue = useDatabaseTaskQueue();
  useEffect(() => {
    const ignore = () => {
      /* L’UI de réglage signalera une erreur ; aucune donnée médicale n’est journalisée. */
    };
    const synchronize = () => {
      // Les deux opérations écrivent dans la même base : la file les exécute
      // l’une après l’autre au lieu de les laisser se chevaucher. Elles restent
      // indépendantes, l’échec de l’une ne devant pas empêcher l’autre.
      void queue.run(() => synchronizeIntakeReminders(database)).catch(ignore);
      void queue
        .run(() => reconcileIntakePostponements(database))
        .catch(ignore);
    };
    synchronize();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') synchronize();
    });
    return () => subscription.remove();
  }, [database, queue]);
  return null;
}

/**
 * Exécute les actions rapides des notifications de prise.
 *
 * Le composant est monté à l’intérieur de `DatabaseProvider` mais en dehors de
 * `AppLockGate` : l’écriture doit aboutir sans attendre l’authentification du
 * verrou, qui ne concerne que l’affichage. Le bouton de validation ramène par
 * ailleurs PillBox au premier plan (voir `notification-actions.ts`), mais
 * cette écriture reste indépendante de la navigation qui s’ensuit.
 *
 * L’écriture est idempotente : seules les prises encore en attente changent
 * d’état. Une réponse reçue deux fois, ou rejouée au démarrage suivant, ne crée
 * donc aucun doublon et ne réécrit pas l’heure d’une prise déjà validée.
 *
 * Une fois l’écriture confirmée, la notification est retirée du tiroir Android :
 * l’action prise en compte cesse d’être proposée. L’ordre est porté par
 * `runNotificationCommand`, testable sans module natif.
 */
function IntakeActionCoordinator() {
  const database = useSQLiteContext();
  const queue = useDatabaseTaskQueue();
  useEffect(() => {
    let released = false;

    function handle(response: Notifications.NotificationResponse): void {
      const command = notificationCommandOf(response);
      if (command === null) return;
      void runNotificationCommand(command, {
        // L’écriture passe par la file, comme la synchronisation des rappels,
        // mais devant celles qui attendent : l’action vient de l’utilisatrice et
        // doit aboutir même si l’application n’est pas passée au premier plan.
        // Traitée avant la synchronisation, elle lui fournit en prime des
        // compteurs de prises en attente déjà à jour.
        validate: (groups) =>
          queue.run(() => markPendingIntakesTakenForGroups(database, groups), {
            first: true,
          }),
        // Le retrait n’est pas conditionné au montage : la notification doit
        // disparaître même si l’écran a été démonté entre-temps.
        dismiss: () => dismissRespondedNotification(response),
        acknowledge: () => {
          // La réponse traitée ne doit pas être rejouée au prochain démarrage.
          if (!released) Notifications.clearLastNotificationResponse();
        },
      });
      // Une écriture échouée laisse la réponse en attente : elle sera rejouée au
      // démarrage suivant, sans risque de doublon, et la notification reste
      // affichée. Aucune donnée n’est journalisée.
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
  }, [database, queue]);
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
      return;
    case 'pending-completion':
      if (target.preparationId !== null && target.specialtyCis !== null) {
        router.push({
          pathname: PENDING_COMPLETION_COMPLETE_ROUTE,
          params: {
            preparationId: String(target.preparationId),
            specialtyCis: target.specialtyCis,
          },
        });
        return;
      }
      // Donnée absente ou illisible (notification programmée avant ce
      // ticket, ou payload corrompu) : repli sur l'écran générique plutôt
      // que de deviner la préparation ou le médicament concernés.
      router.push(PENDING_COMPLETION_ROUTE);
  }
}

/**
 * Ouvre l’écran correspondant à la notification touchée, que l’appui vienne du
 * corps de la notification ou de son bouton « Ouvrir PillBox » : les deux gestes
 * partagent la même navigation différée, aucune prise n’est validée au passage.
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
      // Deux gestes ouvrent PillBox et mènent au même écran : l’appui standard
      // sur la notification et le bouton « Ouvrir PillBox ». Le bouton de
      // validation, lui, n’ouvre rien et ne navigue donc jamais.
      const opening = notificationOpening(response);
      if (opening === null) return;
      const target = notificationTargetOf(response.notification);
      if (target !== null) navigation.request(target);
      // Android retire de lui-même la notification touchée en son corps, mais
      // laisse affichée celle dont on presse un bouton : le geste explicite
      // d’ouverture doit aboutir au même tiroir vide.
      if (opening === 'action-button')
        void dismissRespondedNotification(response).catch(() => {
          /* L’écran demandé s’ouvre malgré tout ; aucune donnée n’est journalisée. */
        });
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
