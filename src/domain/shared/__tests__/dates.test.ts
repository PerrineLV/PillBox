import { addCivilDays } from '../dates';

describe('addCivilDays', () => {
  it('ajoute des jours civils en tenant compte du changement de mois', () => {
    expect(addCivilDays('2026-01-30', 3)).toBe('2026-02-02');
  });

  it('retranche des jours civils avec un nombre négatif', () => {
    expect(addCivilDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('accepte un décalage nul', () => {
    expect(addCivilDays('2026-05-15', 0)).toBe('2026-05-15');
  });

  it('refuse un format qui ne respecte pas YYYY-MM-DD', () => {
    expect(() => addCivilDays('15/05/2026', 1)).toThrow('Date invalide.');
  });

  it('refuse une date calendaire inexistante', () => {
    expect(() => addCivilDays('2026-02-30', 1)).toThrow('Date invalide.');
  });
});
