import {
  assertValidReminderSchedule,
  expoWeekday,
  formatReminderTime,
} from '../preparation-reminder';

describe('rappel hebdomadaire de préparation', () => {
  it('convertit les jours vers la convention Expo où dimanche vaut 1', () => {
    expect(expoWeekday('sunday')).toBe(1);
    expect(expoWeekday('monday')).toBe(2);
    expect(expoWeekday('saturday')).toBe(7);
  });

  it('valide uniquement une heure civile complète', () => {
    expect(() =>
      assertValidReminderSchedule({ weekday: 'monday', hour: 23, minute: 59 }),
    ).not.toThrow();
    expect(() =>
      assertValidReminderSchedule({ weekday: 'monday', hour: 24, minute: 0 }),
    ).toThrow('Heure');
    expect(() =>
      assertValidReminderSchedule({ weekday: 'monday', hour: 12, minute: 60 }),
    ).toThrow('Minute');
  });

  it('formate une heure sans dépendre du fuseau du téléphone', () => {
    expect(formatReminderTime(8, 5)).toBe('08:05');
  });
});
