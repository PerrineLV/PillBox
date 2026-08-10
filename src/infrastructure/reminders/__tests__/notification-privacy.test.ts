import { INTAKE_ACTION_CATEGORIES } from '@/domain/reminders/notification-actions';
import { NEUTRAL_REMINDER_CONTENT } from '../local-notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly' },
}));

const SENSITIVE =
  /mg|comprim|gélule|lot|stock|dose|posologie|traitement|médicament|CIP|GTIN/i;

describe('confidentialité des notifications', () => {
  it('utilise uniquement un texte neutre', () => {
    const visible = `${NEUTRAL_REMINDER_CONTENT.title} ${NEUTRAL_REMINDER_CONTENT.body}`;
    expect(visible).toBe(
      'Rappel PillBox Une action planifiée vous attend dans l’application.',
    );
    expect(visible).not.toMatch(SENSITIVE);
  });

  it('n’expose rien de sensible dans les libellés des actions rapides', () => {
    const titles = INTAKE_ACTION_CATEGORIES.map(
      (category) => category.buttonTitle,
    );
    expect(titles).toEqual(['Valider', 'Tout valider']);
    for (const title of titles) expect(title).not.toMatch(SENSITIVE);
  });
});
