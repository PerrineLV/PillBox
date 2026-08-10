import {
  GROUP_INTAKE_CATEGORY,
  intakeActionCategory,
  INTAKE_ACTION_CATEGORIES,
  notificationCommand,
  SINGLE_INTAKE_CATEGORY,
  VALIDATE_INTAKES_ACTION,
} from '../notification-actions';
import {
  INTAKE_REMINDER_KIND,
  POSTPONED_INTAKE_KIND,
  PREPARATION_REMINDER_KIND,
  PREPARATION_ROUTE,
} from '../notification-navigation';

describe('catégorie d’action d’un rappel de prise', () => {
  it('ne propose aucun bouton lorsqu’il n’y a rien à valider', () => {
    expect(intakeActionCategory(0)).toBeNull();
    expect(intakeActionCategory(-1)).toBeNull();
    expect(intakeActionCategory(1.5)).toBeNull();
  });

  it('propose « Valider » pour une seule prise en attente', () => {
    expect(intakeActionCategory(1)).toBe(SINGLE_INTAKE_CATEGORY);
  });

  it('propose « Tout valider » à partir de deux prises en attente', () => {
    expect(intakeActionCategory(2)).toBe(GROUP_INTAKE_CATEGORY);
    expect(intakeActionCategory(7)).toBe(GROUP_INTAKE_CATEGORY);
  });

  it('expose exactement les deux libellés attendus', () => {
    expect(INTAKE_ACTION_CATEGORIES).toEqual([
      { identifier: SINGLE_INTAKE_CATEGORY, buttonTitle: 'Valider' },
      { identifier: GROUP_INTAKE_CATEGORY, buttonTitle: 'Tout valider' },
    ]);
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
