import type * as Notifications from 'expo-notifications';

import {
  GROUP_INTAKE_CATEGORY,
  OPEN_APP_ACTION,
  OPEN_ONLY_INTAKE_CATEGORY,
  SINGLE_INTAKE_CATEGORY,
  VALIDATE_INTAKES_ACTION,
} from '@/domain/reminders/notification-actions';
import {
  dismissRespondedNotification,
  notificationOpening,
  scheduleIntakeReminder,
} from '../local-notifications';

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

const mockDismissNotificationAsync = jest.fn<Promise<void>, [string]>();
const mockSetNotificationCategoryAsync = jest.fn<Promise<void>, [string, []]>();
const mockScheduleNotificationAsync = jest.fn<Promise<string>, [unknown]>();

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  SchedulableTriggerInputTypes: { DATE: 'date', WEEKLY: 'weekly' },
  dismissNotificationAsync: (identifier: string) =>
    mockDismissNotificationAsync(identifier),
  setNotificationCategoryAsync: (identifier: string, actions: []) =>
    mockSetNotificationCategoryAsync(identifier, actions),
  setNotificationChannelAsync: () => Promise.resolve(),
  scheduleNotificationAsync: (request: unknown) =>
    mockScheduleNotificationAsync(request),
}));

function response(
  actionIdentifier: string,
  identifier = 'rappel',
): Notifications.NotificationResponse {
  return {
    actionIdentifier,
    notification: { request: { identifier } },
  } as Notifications.NotificationResponse;
}

beforeEach(() => {
  mockDismissNotificationAsync.mockReset();
  mockDismissNotificationAsync.mockResolvedValue(undefined);
  mockSetNotificationCategoryAsync.mockReset();
  mockSetNotificationCategoryAsync.mockResolvedValue(undefined);
  mockScheduleNotificationAsync.mockReset();
  mockScheduleNotificationAsync.mockResolvedValue('identifiant');
});

describe('disparition d’une notification après une action rapide', () => {
  it('retire du tiroir la notification qui a produit la réponse', async () => {
    await dismissRespondedNotification(
      response(VALIDATE_INTAKES_ACTION, 'matin'),
    );

    expect(mockDismissNotificationAsync).toHaveBeenCalledWith('matin');
  });

  it('propage l’échec du retrait pour ne pas le confondre avec un succès', async () => {
    mockDismissNotificationAsync.mockRejectedValue(
      new Error('module indisponible'),
    );

    await expect(
      dismissRespondedNotification(response(VALIDATE_INTAKES_ACTION, 'soir')),
    ).rejects.toThrow('module indisponible');
  });
});

describe('réponses qui ouvrent l’application', () => {
  it('reconnaît l’appui standard sur le corps de la notification', () => {
    expect(notificationOpening(response(DEFAULT_ACTION))).toBe('tap');
  });

  it('reconnaît le bouton « Ouvrir PillBox »', () => {
    expect(notificationOpening(response(OPEN_APP_ACTION))).toBe(
      'action-button',
    );
  });

  it('n’ouvre rien depuis le bouton de validation', () => {
    expect(notificationOpening(response(VALIDATE_INTAKES_ACTION))).toBeNull();
  });

  it('n’ouvre rien depuis une action inconnue', () => {
    expect(notificationOpening(response('autre-action'))).toBeNull();
  });
});

describe('boutons attachés à un rappel de prise', () => {
  async function schedule(pendingCount: number) {
    await scheduleIntakeReminder(
      new Date('2026-08-12T07:00:00.000Z'),
      [{ date: '2026-08-12', slot: 'morning' }],
      pendingCount,
    );
    const request = mockScheduleNotificationAsync.mock.calls[0]?.[0] as {
      content: { categoryIdentifier?: string };
    };
    return request.content.categoryIdentifier;
  }

  function declaredActions(categoryIdentifier: string) {
    const call = mockSetNotificationCategoryAsync.mock.calls.find(
      ([identifier]) => identifier === categoryIdentifier,
    );
    if (call === undefined) throw new Error(`catégorie ${categoryIdentifier}`);
    return call[1] as {
      identifier: string;
      buttonTitle: string;
      options: { opensAppToForeground: boolean };
    }[];
  }

  it('déclare la validation puis l’ouverture pour une prise en attente', async () => {
    expect(await schedule(1)).toBe(SINGLE_INTAKE_CATEGORY);

    expect(declaredActions(SINGLE_INTAKE_CATEGORY)).toEqual([
      {
        identifier: VALIDATE_INTAKES_ACTION,
        buttonTitle: 'Valider',
        options: { opensAppToForeground: false },
      },
      {
        identifier: OPEN_APP_ACTION,
        buttonTitle: 'Ouvrir PillBox',
        options: { opensAppToForeground: true },
      },
    ]);
  });

  it('déclare « Tout valider » puis l’ouverture pour plusieurs prises', async () => {
    expect(await schedule(3)).toBe(GROUP_INTAKE_CATEGORY);

    expect(
      declaredActions(GROUP_INTAKE_CATEGORY).map(
        (action) => action.buttonTitle,
      ),
    ).toEqual(['Tout valider', 'Ouvrir PillBox']);
  });

  it('garde le bouton d’ouverture quand il n’y a rien à valider', async () => {
    expect(await schedule(0)).toBe(OPEN_ONLY_INTAKE_CATEGORY);

    expect(declaredActions(OPEN_ONLY_INTAKE_CATEGORY)).toEqual([
      {
        identifier: OPEN_APP_ACTION,
        buttonTitle: 'Ouvrir PillBox',
        options: { opensAppToForeground: true },
      },
    ]);
  });
});
