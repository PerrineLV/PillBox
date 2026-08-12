import { INTAKE_ACTION_CATEGORIES } from '@/domain/reminders/notification-actions';
import {
  intakeReminderContent,
  PREPARATION_REMINDER_CONTENT,
} from '../local-notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly' },
}));

// Le contenu peut mentionner qu'il s'agit de médicaments à prendre, mais ne doit
// jamais nommer un médicament précis, une posologie, un lot ou une quantité de stock.
const SENSITIVE =
  /mg|comprim|gélule|\blot\b|stock|dose|posologie|traitement|CIP|GTIN/i;

describe('confidentialité des notifications', () => {
  it('rappel de préparation : informatif mais sans détail sensible', () => {
    const visible = `${PREPARATION_REMINDER_CONTENT.title} ${PREPARATION_REMINDER_CONTENT.body}`;
    expect(visible).toBe('PillBox Vous avez un pilulier à remplir.');
    expect(visible).not.toMatch(SENSITIVE);
  });

  it('rappel de prise : accorde le pluriel et reste sans détail sensible', () => {
    const singular = intakeReminderContent(1);
    expect(`${singular.title} ${singular.body}`).toBe(
      'PillBox Vous avez 1 médicament à prendre.',
    );
    const plural = intakeReminderContent(3);
    expect(`${plural.title} ${plural.body}`).toBe(
      'PillBox Vous avez 3 médicaments à prendre.',
    );
    expect(plural.body).not.toMatch(SENSITIVE);
  });

  it('n’expose rien de sensible dans les libellés des actions rapides', () => {
    const titles = INTAKE_ACTION_CATEGORIES.flatMap((category) =>
      category.buttons.map((button) => button.buttonTitle),
    );
    expect(new Set(titles)).toEqual(
      new Set(['Valider', 'Tout valider', 'Ouvrir PillBox']),
    );
    for (const title of titles) expect(title).not.toMatch(SENSITIVE);
  });
});
