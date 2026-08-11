import {
  ANDROID_MAXIMUM_NOTIFICATION_ACTIONS,
  GROUP_INTAKE_CATEGORY,
  intakeActionCategory,
  INTAKE_ACTION_CATEGORIES,
  notificationCommand,
  OPEN_APP_ACTION,
  OPEN_APP_BUTTON_TITLE,
  OPEN_ONLY_INTAKE_CATEGORY,
  runNotificationCommand,
  SINGLE_INTAKE_CATEGORY,
  VALIDATE_INTAKES_ACTION,
  type IntakeActionButton,
  type NotificationCommand,
} from '../notification-actions';
import {
  INTAKE_REMINDER_KIND,
  POSTPONED_INTAKE_KIND,
  PREPARATION_REMINDER_KIND,
  PREPARATION_ROUTE,
  type IntakeGroupReference,
} from '../notification-navigation';

describe('catégorie d’action d’un rappel de prise', () => {
  function buttonsOf(identifier: string): readonly IntakeActionButton[] {
    const category = INTAKE_ACTION_CATEGORIES.find(
      (item) => item.identifier === identifier,
    );
    if (category === undefined) throw new Error(`catégorie ${identifier}`);
    return category.buttons;
  }

  it('ne propose pas de validation lorsqu’il n’y a rien à valider', () => {
    expect(intakeActionCategory(0)).toBe(OPEN_ONLY_INTAKE_CATEGORY);
    expect(intakeActionCategory(-1)).toBe(OPEN_ONLY_INTAKE_CATEGORY);
    expect(intakeActionCategory(1.5)).toBe(OPEN_ONLY_INTAKE_CATEGORY);
    expect(
      buttonsOf(OPEN_ONLY_INTAKE_CATEGORY).map((b) => b.buttonTitle),
    ).toEqual([OPEN_APP_BUTTON_TITLE]);
  });

  it('propose « Valider » pour une seule prise en attente', () => {
    expect(intakeActionCategory(1)).toBe(SINGLE_INTAKE_CATEGORY);
    expect(buttonsOf(SINGLE_INTAKE_CATEGORY).map((b) => b.buttonTitle)).toEqual(
      ['Valider', OPEN_APP_BUTTON_TITLE],
    );
  });

  it('propose « Tout valider » à partir de deux prises en attente', () => {
    expect(intakeActionCategory(2)).toBe(GROUP_INTAKE_CATEGORY);
    expect(intakeActionCategory(7)).toBe(GROUP_INTAKE_CATEGORY);
    expect(buttonsOf(GROUP_INTAKE_CATEGORY).map((b) => b.buttonTitle)).toEqual([
      'Tout valider',
      OPEN_APP_BUTTON_TITLE,
    ]);
  });

  it('propose « Ouvrir PillBox » sur chaque notification de prise', () => {
    for (const category of INTAKE_ACTION_CATEGORIES) {
      expect(category.buttons).toContainEqual({
        identifier: OPEN_APP_ACTION,
        buttonTitle: OPEN_APP_BUTTON_TITLE,
        opensApp: true,
      });
    }
  });

  it('n’ouvre l’application que par le bouton dédié', () => {
    for (const category of INTAKE_ACTION_CATEGORIES) {
      for (const button of category.buttons) {
        expect(button.opensApp).toBe(button.identifier === OPEN_APP_ACTION);
      }
    }
  });

  it('respecte la limite Android de boutons par notification', () => {
    for (const category of INTAKE_ACTION_CATEGORIES) {
      expect(category.buttons.length).toBeLessThanOrEqual(
        ANDROID_MAXIMUM_NOTIFICATION_ACTIONS,
      );
    }
  });
});

describe('commande demandée par une réponse de notification', () => {
  const plannedData = {
    kind: INTAKE_REMINDER_KIND,
    scheduledAt: '2026-08-10T06:00:00.000Z',
    groups: '2026-08-10:morning,2026-08-10:noon',
  };

  it('valide les créneaux du rappel touché', () => {
    expect(notificationCommand(VALIDATE_INTAKES_ACTION, plannedData)).toEqual({
      kind: 'validate-intakes',
      groups: [
        { date: '2026-08-10', slot: 'morning' },
        { date: '2026-08-10', slot: 'noon' },
      ],
    });
  });

  it('valide le créneau d’un rappel reporté', () => {
    expect(
      notificationCommand(VALIDATE_INTAKES_ACTION, {
        kind: POSTPONED_INTAKE_KIND,
        date: '2026-08-10',
        slot: 'evening',
      }),
    ).toEqual({
      kind: 'validate-intakes',
      groups: [{ date: '2026-08-10', slot: 'evening' }],
    });
  });

  it('ignore un appui standard sur la notification', () => {
    expect(
      notificationCommand(
        'expo.modules.notifications.actions.DEFAULT',
        plannedData,
      ),
    ).toBeNull();
  });

  it('ignore une action inconnue', () => {
    expect(notificationCommand('autre-action', plannedData)).toBeNull();
  });

  it('ne valide rien depuis le bouton « Ouvrir PillBox »', () => {
    expect(notificationCommand(OPEN_APP_ACTION, plannedData)).toBeNull();
    expect(
      notificationCommand(OPEN_APP_ACTION, {
        kind: POSTPONED_INTAKE_KIND,
        date: '2026-08-10',
        slot: 'evening',
      }),
    ).toBeNull();
  });

  it('ne valide rien depuis un rappel de préparation', () => {
    expect(
      notificationCommand(VALIDATE_INTAKES_ACTION, {
        kind: PREPARATION_REMINDER_KIND,
        url: PREPARATION_ROUTE,
      }),
    ).toBeNull();
  });

  it('ne devine aucun créneau lorsque les données sont absentes ou illisibles', () => {
    expect(notificationCommand(VALIDATE_INTAKES_ACTION, null)).toBeNull();
    expect(notificationCommand(VALIDATE_INTAKES_ACTION, {})).toBeNull();
    expect(
      notificationCommand(VALIDATE_INTAKES_ACTION, {
        ...plannedData,
        groups: 'pas-une-date:morning',
      }),
    ).toBeNull();
    expect(
      notificationCommand(VALIDATE_INTAKES_ACTION, {
        kind: POSTPONED_INTAKE_KIND,
        date: '2026-08-10',
        slot: 'gouter',
      }),
    ).toBeNull();
  });
});

describe('exécution d’une commande de notification', () => {
  const command: NotificationCommand = {
    kind: 'validate-intakes',
    groups: [{ date: '2026-08-10', slot: 'morning' }],
  };

  function recorder() {
    const calls: string[] = [];
    return {
      calls,
      effects: {
        validate: async (groups: readonly IntakeGroupReference[]) => {
          calls.push(`validate:${groups.length}`);
        },
        dismiss: async () => {
          calls.push('dismiss');
        },
        acknowledge: () => {
          calls.push('acknowledge');
        },
      },
    };
  }

  it('fait disparaître la notification après l’écriture réussie', async () => {
    const { calls, effects } = recorder();

    await runNotificationCommand(command, effects);

    expect(calls).toEqual(['validate:1', 'dismiss', 'acknowledge']);
  });

  it('ne fait rien disparaître tant que l’écriture n’est pas confirmée', async () => {
    const { calls, effects } = recorder();
    let confirm = (): void => {};
    const running = runNotificationCommand(command, {
      ...effects,
      validate: () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    });

    expect(calls).toEqual([]);
    confirm();
    await running;

    expect(calls).toEqual(['dismiss', 'acknowledge']);
  });

  it('laisse la notification affichée lorsque l’écriture échoue', async () => {
    const { calls, effects } = recorder();

    await runNotificationCommand(command, {
      ...effects,
      validate: () => Promise.reject(new Error('SQLITE_BUSY')),
    });

    expect(calls).toEqual([]);
  });

  it('considère l’action traitée même si la notification a déjà disparu', async () => {
    const { calls, effects } = recorder();

    await runNotificationCommand(command, {
      ...effects,
      dismiss: () => Promise.reject(new Error('notification inconnue')),
    });

    expect(calls).toEqual(['validate:1', 'acknowledge']);
  });

  it('reste sans erreur lorsqu’une même réponse est traitée deux fois', async () => {
    const { calls, effects } = recorder();

    await runNotificationCommand(command, effects);
    await runNotificationCommand(command, effects);

    expect(calls).toEqual([
      'validate:1',
      'dismiss',
      'acknowledge',
      'validate:1',
      'dismiss',
      'acknowledge',
    ]);
  });
});
