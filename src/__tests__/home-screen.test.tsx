import { HomeContent } from '../app/index';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));

describe('HomeScreen', () => {
  it('affiche le titre de l’application', () => {
    const screen = HomeContent({ alerts: null, loading: false, error: null });
    expect(JSON.stringify(screen)).toContain('PillBox');
    expect(JSON.stringify(screen)).toContain('Préparer mon pilulier');
  });

  it('affiche les alertes de stock et de péremption', () => {
    const screen = HomeContent({
      loading: false,
      error: null,
      alerts: {
        startDate: '2026-08-10',
        endDate: '2026-08-16',
        stock: [
          {
            status: 'INSUFFICIENT',
            specialtyCis: '1',
            specialtyName: 'Alpha',
            requiredHalfUnits: 14,
            usableStockHalfUnits: 10,
            missingHalfUnits: 4,
          },
        ],
        expirations: [
          {
            boxId: 2,
            specialtyName: 'Beta',
            lot: 'LOT-B',
            expirationDate: '2026-08-20',
            remainingQuantity: 5,
          },
        ],
      },
    });
    const rendered = JSON.stringify(screen);
    expect(rendered).toContain('À vérifier avant le prochain pilulier');
    expect(rendered).toContain('Stock insuffisant');
    expect(rendered).toContain('LOT-B');
  });
});
