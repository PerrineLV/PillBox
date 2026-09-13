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
    expect(rendered).toContain('complète');
    expect(rendered).toContain('plus tard');
    expect(rendered).toContain('→');
    expect(rendered).toContain('✓');
  });
});
