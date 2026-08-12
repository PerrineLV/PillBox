import type { SourceDates } from '../bdpm-source-dates';
import { updateReferenceDocDates } from '../update-reference-doc';

const SNAPSHOT_PARAGRAPH =
  'Avant.\n\n' +
  'Le snapshot actuellement livré (`assets/medications/medications.db`) a été construit avec ' +
  'les spécialités et les groupes génériques datés du **03/08/2026** et les présentations ' +
  'datées du **10/08/2026**, dates affichées par la BDPM au téléchargement.\n\n' +
  'Après.';

const NEW_DATES: SourceDates = {
  specialtiesSourceDate: '2026-09-07',
  presentationsSourceDate: '2026-09-14',
  genericsSourceDate: '2026-09-07',
};

describe('updateReferenceDocDates', () => {
  it('remplace la phrase des dates par les nouvelles dates', () => {
    const updated = updateReferenceDocDates(SNAPSHOT_PARAGRAPH, NEW_DATES);
    expect(updated).toContain('daté du **07/09/2026**');
    expect(updated).toContain('daté du **14/09/2026**');
    expect(updated).not.toContain('03/08/2026');
    expect(updated).not.toContain('10/08/2026');
    expect(updated).toContain('Avant.');
    expect(updated).toContain('Après.');
  });

  it('échoue explicitement si la phrase attendue est introuvable', () => {
    expect(() =>
      updateReferenceDocDates('Aucune phrase ici.', NEW_DATES),
    ).toThrow(/phrase des dates du snapshot introuvable/);
  });
});
