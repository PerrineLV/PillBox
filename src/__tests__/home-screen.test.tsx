import { HomeContent } from '../app/index';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));

describe('HomeScreen', () => {
  it('affiche le titre de l’application', () => {
    const screen = HomeContent({ alerts: null, loading: false, error: null });
    expect(JSON.stringify(screen)).toContain('PillBox');
    expect(JSON.stringify(screen)).toContain('Préparer les 7 prochains jours');
    expect(JSON.stringify(screen)).toContain('Commencer');
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
    expect(rendered).toContain('À vérifier');
    expect(rendered).toContain('Stock insuffisant');
    expect(rendered).toContain('LOT-B');
  });

  it('ajoute la date de rupture estimée à une alerte de stock', () => {
    const rendered = JSON.stringify(
      HomeContent({
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
          expirations: [],
        },
        forecasts: new Map([
          [
            '1',
            {
              specialtyCis: '1',
              specialtyName: 'Alpha',
              availableHalfUnits: 10,
              nextPreparationHalfUnits: 14,
              missingHalfUnits: 4,
              insufficientForNextPreparation: true,
              coverage: {
                status: 'RUNS_OUT',
                date: '2026-08-15',
                cause: 'CONSUMED',
                coveredDays: 5,
              },
            },
          ],
        ]),
      }),
    );
    expect(rendered).toContain('Rupture estimée le 15 août 2026');
  });

  it('n’affiche aucune information de mise à jour quand l’app est à jour', () => {
    const screen = HomeContent({ alerts: null, loading: false, error: null });
    expect(JSON.stringify(screen)).not.toContain('Mise à jour');
  });

  it('affiche la mise à jour disponible sans masquer le parcours principal', () => {
    const rendered = JSON.stringify(
      HomeContent({
        alerts: null,
        loading: false,
        error: null,
        updateNotice: {
          version: '1.0.42',
          installedVersion: '1.0.41',
          downloadUrl:
            'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk',
          fallbackToReleasePage: false,
        },
        onDownloadUpdate: jest.fn(),
        onPostponeUpdate: jest.fn(),
      }),
    );

    // Le contenu de la carte est vérifié par son propre test ; ici seule sa
    // présence sur l’accueil compte.
    expect(rendered).toContain('"version":"1.0.42"');
    expect(rendered).toContain('"installedVersion":"1.0.41"');
    // La préparation du pilulier reste accessible : l’alerte ne bloque rien.
    expect(rendered).toContain('Commencer');
  });
});
