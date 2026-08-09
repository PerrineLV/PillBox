import { NEUTRAL_REMINDER_CONTENT } from '../local-notifications';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  SchedulableTriggerInputTypes: { WEEKLY: 'weekly' },
}));

describe('confidentialité des notifications', () => {
  it('utilise uniquement un texte neutre', () => {
    const visible = `${NEUTRAL_REMINDER_CONTENT.title} ${NEUTRAL_REMINDER_CONTENT.body}`;
    expect(visible).toBe(
      'Rappel PillBox Une action planifiée vous attend dans l’application.',
    );
    expect(visible).not.toMatch(
      /mg|comprim|gélule|lot|stock|dose|posologie|traitement|médicament|CIP|GTIN/i,
    );
  });
});
