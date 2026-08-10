import {
  civilDateToPickerDate,
  formatFullFrenchCivilDate,
  formatFrenchCivilDate,
  formatLongFrenchCivilDate,
  nextCivilDay,
  pickerDateToCivilDate,
} from '../civil-date';

describe('dates civiles du formulaire', () => {
  it('affiche une date ISO au format français', () => {
    expect(formatFrenchCivilDate('2026-08-09')).toBe('09/08/2026');
  });

  it('affiche une date civile en français long', () => {
    expect(formatLongFrenchCivilDate('2026-08-09')).toBe('9 août 2026');
    expect(formatLongFrenchCivilDate('inconnue')).toBe('inconnue');
  });

  it('peut inclure le jour de la semaine', () => {
    expect(formatFullFrenchCivilDate('2026-08-09')).toBe(
      'dimanche 9 août 2026',
    );
  });

  it('préserve le jour civil lors du passage par le calendrier', () => {
    const pickerDate = civilDateToPickerDate('2026-03-29');
    expect(pickerDate).not.toBeNull();
    expect(pickerDateToCivilDate(pickerDate as Date)).toBe('2026-03-29');
  });

  it('refuse une date civile impossible', () => {
    expect(civilDateToPickerDate('2026-02-30')).toBeNull();
  });

  it('calcule le lendemain, y compris aux changements de mois et d’année', () => {
    expect(nextCivilDay('2026-08-09')).toBe('2026-08-10');
    expect(nextCivilDay('2026-08-31')).toBe('2026-09-01');
    expect(nextCivilDay('2026-12-31')).toBe('2027-01-01');
    expect(nextCivilDay('2024-02-28')).toBe('2024-02-29');
    expect(nextCivilDay('2026-02-28')).toBe('2026-03-01');
  });

  it('ne calcule aucun lendemain pour une date inexploitable', () => {
    expect(nextCivilDay('')).toBeNull();
    expect(nextCivilDay('2026-02-30')).toBeNull();
  });
});
