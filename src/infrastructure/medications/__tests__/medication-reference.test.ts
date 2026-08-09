import { buildMedicationFtsQuery } from '@/domain/medications/normalize-medication-search';

describe('buildMedicationFtsQuery', () => {
  it('normalise casse, accents et dosage en préfixes FTS sûrs', () => {
    expect(buildMedicationFtsQuery('Éfféralgan 500 mg')).toBe(
      'efferalgan* AND 500* AND mg*',
    );
  });

  it('ignore une recherche vide ou uniquement ponctuée', () => {
    expect(buildMedicationFtsQuery(' -- ')).toBeNull();
  });

  it('retrouve aussi un dosage saisi sans espace', () => {
    expect(buildMedicationFtsQuery('500mg')).toBe('500* AND mg*');
  });
});
