import { PreparationGrid } from '../preparation-grid';
import { buildWeeklyGrid } from '@/domain/home/weekly-grid';

describe('PreparationGrid', () => {
  it('explique les états autrement que par la couleur', () => {
    const grid = buildWeeklyGrid({
      startDate: '2026-09-14',
      items: [
        {
          date: '2026-09-14',
          slot: 'morning',
          specialtyCis: 'A',
          quantityHalfUnits: 2,
        },
      ],
      currentCis: 'A',
    });

    const rendered = JSON.stringify(PreparationGrid({ grid }));

    expect(rendered).toContain('à remplir maintenant');
    expect(rendered).toContain('remplie (tous les médicaments)');
    expect(rendered).toContain('plus tard');
    expect(rendered).toContain('→');
    expect(rendered).toContain('✓');
    expect(rendered).toContain('non concernée');
    expect(rendered).toContain('—');
    expect(rendered).toContain(
      'Lundi 14 septembre, Matin : à remplir maintenant',
    );
  });
});

it('restitue les états lors de la reprise, sans confondre un autre médicament avec une case vide', () => {
  const grid = buildWeeklyGrid({
    startDate: '2026-09-14',
    items: [
      {
        date: '2026-09-14',
        slot: 'morning',
        specialtyCis: 'A',
        quantityHalfUnits: 2,
      },
      {
        date: '2026-09-15',
        slot: 'morning',
        specialtyCis: 'A',
        quantityHalfUnits: 2,
      },
      {
        date: '2026-09-16',
        slot: 'morning',
        specialtyCis: 'B',
        quantityHalfUnits: 2,
      },
    ],
    currentCis: 'A',
    preparedContributions: [{ specialtyCis: 'A', quantityHalfUnits: 2 }],
  });
  const rendered = JSON.stringify(PreparationGrid({ grid }));
  expect(rendered).toContain(
    'Lundi 14 septembre, Matin : remplie (tous les médicaments)',
  );
  expect(rendered).toContain(
    'Mardi 15 septembre, Matin : à remplir maintenant',
  );
  expect(rendered).toContain('Mercredi 16 septembre, Matin : plus tard');
  expect(rendered).toContain('Jeudi 17 septembre, Matin : non concernée');
});
