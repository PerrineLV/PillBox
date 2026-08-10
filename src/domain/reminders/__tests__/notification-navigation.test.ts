import {
  createDeferredNotificationNavigation,
  notificationTarget,
  PREPARATION_ROUTE,
  type NotificationTarget,
} from '../notification-navigation';

describe('cible de navigation d’une notification', () => {
  it('reconnaît le rappel de préparation', () => {
    expect(
      notificationTarget({
        kind: 'pillbox-preparation-reminder',
        url: PREPARATION_ROUTE,
      }),
    ).toEqual({ kind: 'preparation' });
  });

  it('reconnaît un rappel de prise et conserve ses créneaux', () => {
    expect(
      notificationTarget({
        kind: 'pillbox-intake-reminder',
        scheduledAt: '2026-08-10T08:00:00.000Z',
        groups: '2026-08-10:morning,2026-08-10:noon',
      }),
    ).toEqual({
      kind: 'planned-intake',
      at: '2026-08-10T08:00:00.000Z',
      groups: [
        { date: '2026-08-10', slot: 'morning' },
        { date: '2026-08-10', slot: 'noon' },
      ],
    });
  });

  it('reconnaît un rappel de prise reporté', () => {
    expect(
      notificationTarget({
        kind: 'pillbox-postponed-intake-reminder',
        date: '2026-08-10',
        slot: 'evening',
      }),
    ).toEqual({
      kind: 'postponed-intake',
      date: '2026-08-10',
      slot: 'evening',
    });
  });

  it('ignore les créneaux illisibles sans perdre le rappel', () => {
    expect(
      notificationTarget({
        kind: 'pillbox-intake-reminder',
        scheduledAt: '2026-08-10T08:00:00.000Z',
        groups: 'invalide,2026-08-10:bedtime,2026-13-99:morning',
      }),
    ).toEqual({
      kind: 'planned-intake',
      at: '2026-08-10T08:00:00.000Z',
      groups: [{ date: '2026-08-10', slot: 'bedtime' }],
    });
  });

  it('n’invente aucune cible pour une donnée inconnue ou incomplète', () => {
    expect(notificationTarget(undefined)).toBeNull();
    expect(notificationTarget(null)).toBeNull();
    expect(notificationTarget({})).toBeNull();
    expect(notificationTarget({ kind: 'autre-application' })).toBeNull();
    expect(
      notificationTarget({ kind: 'pillbox-preparation-reminder' }),
    ).toBeNull();
    expect(
      notificationTarget({ kind: 'pillbox-intake-reminder', groups: 'x' }),
    ).toBeNull();
    expect(
      notificationTarget({
        kind: 'pillbox-postponed-intake-reminder',
        date: '2026-08-10',
        slot: 'nuit',
      }),
    ).toBeNull();
  });
});

describe('navigation différée jusqu’au montage du routeur', () => {
  const target: NotificationTarget = { kind: 'preparation' };

  function harness(initialReady: boolean) {
    let ready = initialReady;
    const navigate = jest.fn<void, [NotificationTarget]>();
    const acknowledge = jest.fn();
    const navigation = createDeferredNotificationNavigation({
      isReady: () => ready,
      navigate,
      acknowledge,
    });
    return {
      navigate,
      acknowledge,
      navigation,
      becomeReady: () => {
        ready = true;
      },
    };
  }

  it('navigue immédiatement lorsque le routeur est déjà monté', () => {
    const { navigation, navigate, acknowledge } = harness(true);
    navigation.request(target);
    expect(navigate).toHaveBeenCalledWith(target);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it('attend le montage du routeur au lieu de naviguer trop tôt', () => {
    const { navigation, navigate, acknowledge, becomeReady } = harness(false);
    navigation.request(target);
    expect(navigate).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();

    navigation.flush();
    expect(navigate).not.toHaveBeenCalled();

    becomeReady();
    navigation.flush();
    expect(navigate).toHaveBeenCalledWith(target);
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it('ne rejoue pas une navigation déjà effectuée', () => {
    const { navigation, navigate } = harness(true);
    navigation.request(target);
    navigation.flush();
    navigation.flush();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('ne conserve que le dernier appui reçu avant le montage', () => {
    const last: NotificationTarget = {
      kind: 'postponed-intake',
      date: '2026-08-10',
      slot: 'morning',
    };
    const { navigation, navigate, becomeReady } = harness(false);
    navigation.request(target);
    navigation.request(last);
    becomeReady();
    navigation.flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(last);
  });

  it('n’empêche jamais le démarrage lorsque la navigation échoue', () => {
    let ready = true;
    const acknowledge = jest.fn();
    const navigation = createDeferredNotificationNavigation({
      isReady: () => ready,
      navigate: () => {
        throw new Error('routeur indisponible');
      },
      acknowledge,
    });
    expect(() => navigation.request(target)).not.toThrow();
    expect(acknowledge).toHaveBeenCalledTimes(1);
    ready = false;
  });
});
