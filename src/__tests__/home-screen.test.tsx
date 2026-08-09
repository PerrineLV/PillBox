import { HomeContent } from '../app/index';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));

describe('HomeScreen', () => {
  it('affiche le titre de l’application', () => {
    const screen = HomeContent({ alerts: null, loading: false, error: null });
    const [title] = screen.props.children;

    expect(title.props.children).toBe('PillBox');
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
    const alerts = screen.props.children[4];
    expect(alerts.props.children[0].props.children).toBe(
      'À vérifier avant le prochain pilulier',
    );
    expect(
      alerts.props.children[2][0].props.children[1].props.children[0],
    ).toBe('Stock insuffisant');
    expect(
      alerts.props.children[3][0].props.children[1].props.children,
    ).toContain('LOT-B');
  });
});
