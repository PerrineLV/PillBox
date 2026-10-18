import type { PreparationItemSnapshot } from '@/domain/preparations/preparation';
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
    expect(rendered).toContain('Complète : tous les médicaments déposés');
    expect(rendered).toContain('Plus tard');
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

const medicationItems: PreparationItemSnapshot[] = [1, 2, 4].map(
  (quantityHalfUnits, index) => ({
    treatmentId: 1,
    specialtyCis: 'A',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    date: `2026-09-${14 + index}`,
    slot: 'morning',
    quantityHalfUnits,
  }),
);
const medicationGrid = buildWeeklyGrid({
  startDate: '2026-09-14',
  currentCis: 'A',
  items: [
    ...medicationItems,
    { ...medicationItems[0], specialtyCis: 'B', date: '2026-09-17' },
  ],
});

it('affiche ½, 1 et 2 pour le médicament en cours, sans flèches ni points', () => {
  const rendered = JSON.stringify(
    PreparationGrid({
      grid: medicationGrid,
      currentMedication: {
        name: 'Alpha',
        items: medicationItems,
        contributions: [],
      },
    }),
  );
  expect(rendered).toContain('"children":"½"');
  expect(rendered).toContain('"children":"1"');
  expect(rendered).toContain('"children":"2"');
  expect(rendered).toContain(
    'Lundi 14 septembre, Matin : 0,5 à déposer pour Alpha',
  );
  expect(rendered).toContain(
    'Jeudi 17 septembre, Matin : aucune prise de Alpha',
  );
  expect(rendered).not.toContain('→');
  expect(rendered).not.toContain('…');
  expect(rendered).not.toContain('plus tard');
});

it('affiche une coche uniquement pour ce médicament et le reste exact après un dépôt partiel', () => {
  const rendered = JSON.stringify(
    PreparationGrid({
      grid: medicationGrid,
      currentMedication: {
        name: 'Alpha',
        items: medicationItems,
        contributions: [{ boxId: 1, quantityHalfUnits: 2 }],
      },
    }),
  );
  expect(rendered).toContain(
    'Lundi 14 septembre, Matin : déjà déposé pour Alpha',
  );
  expect(rendered).toContain(
    'Mardi 15 septembre, Matin : 0,5 à déposer, 0,5 déjà déposé pour Alpha',
  );
  expect(rendered).toContain(
    'Mercredi 16 septembre, Matin : 2 à déposer pour Alpha',
  );
  expect(rendered).not.toContain('tous les médicaments');
});
