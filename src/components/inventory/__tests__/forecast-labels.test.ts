import {
  forecastAlertBadge,
  forecastAvailabilityLabel,
  forecastCoverageLabel,
  forecastSummary,
} from '../forecast-labels';
import type {
  MedicationForecast,
  StockForecast,
} from '@/domain/forecast/stock-forecast';

const forecast = (
  overrides: Partial<MedicationForecast> = {},
): MedicationForecast => ({
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  availableHalfUnits: 20,
  nextPreparationHalfUnits: 14,
  missingHalfUnits: 0,
  insufficientForNextPreparation: false,
  coverage: {
    status: 'RUNS_OUT',
    date: '2026-08-20',
    cause: 'CONSUMED',
    coveredDays: 10,
  },
  ...overrides,
});

const stockForecast = (
  medications: readonly MedicationForecast[],
): StockForecast => ({
  startDate: '2026-08-10',
  endDate: '2026-08-16',
  horizonDays: 14,
  horizonEndDate: '2026-08-23',
  medications,
});

describe('libellés de prévision', () => {
  it('annonce la date de rupture et les jours couverts', () => {
    expect(forecastCoverageLabel(forecast().coverage)).toBe(
      'Rupture estimée le 20 août 2026, soit 10 jours couverts.',
    );
  });

  it('accorde le singulier sur une seule journée couverte', () => {
    expect(
      forecastCoverageLabel({
        status: 'RUNS_OUT',
        date: '2026-08-11',
        cause: 'CONSUMED',
        coveredDays: 1,
      }),
    ).toBe('Rupture estimée le 11 août 2026, soit 1 jour couvert.');
  });

  it('n’annonce aucun jour couvert lorsque la rupture est immédiate', () => {
    expect(
      forecastCoverageLabel({
        status: 'RUNS_OUT',
        date: '2026-08-10',
        cause: 'CONSUMED',
        coveredDays: 0,
      }),
    ).toBe('Rupture estimée dès le 10 août 2026.');
  });

  it('explique une rupture provoquée par une péremption', () => {
    expect(
      forecastCoverageLabel({
        status: 'RUNS_OUT',
        date: '2026-08-17',
        cause: 'EXPIRED',
        coveredDays: 7,
      }),
    ).toBe(
      'Rupture estimée le 17 août 2026, soit 7 jours couverts. Un lot périme avant d’être consommé.',
    );
  });

  it('renonce à une date au-delà de l’horizon simulé', () => {
    expect(
      forecastCoverageLabel({ status: 'BEYOND_HORIZON', horizonDays: 14 }),
    ).toBe('Aucune rupture prévue dans les 14 prochains jours.');
  });

  it('dit explicitement qu’une date n’est pas calculable sans prise prévue', () => {
    expect(forecastCoverageLabel({ status: 'NO_FUTURE_INTAKE' })).toBe(
      'Aucune prise prévue : la date de rupture n’est pas calculable.',
    );
  });

  it('classe un stock insuffisant pour la prochaine préparation', () => {
    expect(
      forecastAlertBadge(
        forecast({ missingHalfUnits: 4, insufficientForNextPreparation: true }),
      ),
    ).toEqual({
      label: 'Insuffisant pour la prochaine préparation',
      tone: 'danger',
    });
  });

  it('alerte sur toute rupture trouvée dans la fenêtre de prévision', () => {
    expect(forecastAlertBadge(forecast())).toEqual({
      label: 'Rupture à prévoir',
      tone: 'warning',
    });
  });

  it('n’alerte pas sur un stock qui couvre toute la fenêtre', () => {
    expect(
      forecastAlertBadge(
        forecast({ coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 } }),
      ),
    ).toBeNull();
  });

  it('n’alerte pas lorsque aucune prise n’est prévue', () => {
    expect(
      forecastAlertBadge(
        forecast({ coverage: { status: 'NO_FUTURE_INTAKE' } }),
      ),
    ).toBeNull();
  });

  it('résume l’absence de rupture sur toute la fenêtre', () => {
    expect(
      forecastSummary(
        stockForecast([
          forecast({ coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 } }),
          forecast({ coverage: { status: 'NO_FUTURE_INTAKE' } }),
        ]),
      ),
    ).toEqual({
      alertCount: 0,
      label: 'Prévision à 14 jours : aucune rupture prévue.',
    });
  });

  it('compte les médicaments à surveiller sans les énumérer', () => {
    expect(forecastSummary(stockForecast([forecast()]))).toEqual({
      alertCount: 1,
      label: 'Prévision à 14 jours : 1 médicament à surveiller.',
    });
    expect(
      forecastSummary(
        stockForecast([
          forecast(),
          forecast({ insufficientForNextPreparation: true }),
          forecast({ coverage: { status: 'NO_FUTURE_INTAKE' } }),
        ]),
      ),
    ).toEqual({
      alertCount: 2,
      label: 'Prévision à 14 jours : 2 médicaments à surveiller.',
    });
  });

  it('ne compte que les médicaments qui portent réellement une carte', () => {
    const summary = forecastSummary(
      stockForecast([
        forecast({ coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 } }),
        forecast({ coverage: { status: 'NO_FUTURE_INTAKE' } }),
        forecast(),
      ]),
    );
    const cards = stockForecast([
      forecast({ coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 } }),
      forecast({ coverage: { status: 'NO_FUTURE_INTAKE' } }),
      forecast(),
    ]).medications.filter((item) => forecastAlertBadge(item) !== null);
    expect(summary.alertCount).toBe(cards.length);
  });

  it('affiche le disponible face au besoin de la prochaine préparation', () => {
    expect(forecastAvailabilityLabel(forecast())).toBe(
      '10 disponible(s) pour 7 nécessaire(s) la semaine prochaine.',
    );
  });

  it('compte les demi-unités sans arrondi', () => {
    expect(
      forecastAvailabilityLabel(
        forecast({ availableHalfUnits: 5, nextPreparationHalfUnits: 7 }),
      ),
    ).toBe('2,5 disponible(s) pour 3,5 nécessaire(s) la semaine prochaine.');
  });

  it('n’évoque pas de besoin lorsque aucune prise n’est prévue', () => {
    expect(
      forecastAvailabilityLabel(
        forecast({
          nextPreparationHalfUnits: 0,
          coverage: { status: 'NO_FUTURE_INTAKE' },
        }),
      ),
    ).toBe('10 disponible(s), aucune prise prévue la semaine prochaine.');
  });
});
