import {
  DEFAULT_PENDING_COMPLETION_REMINDER_DELAY_DAYS,
  pendingCompletionReminderDate,
} from '../pending-completion-reminder';

describe('pendingCompletionReminderDate', () => {
  it('utilise la date théorique de renouvellement quand elle est renseignée', () => {
    expect(pendingCompletionReminderDate('2026-09-01', '2026-08-12')).toBe(
      '2026-09-01',
    );
  });

  it('retombe sur le délai par défaut sans date théorique', () => {
    expect(pendingCompletionReminderDate(null, '2026-08-12')).toBe(
      '2026-08-19',
    );
    expect(DEFAULT_PENDING_COMPLETION_REMINDER_DELAY_DAYS).toBe(7);
  });

  it('rejette une date de validation invalide', () => {
    expect(() => pendingCompletionReminderDate(null, '12/08/2026')).toThrow(
      'Date invalide.',
    );
  });
});
