import {
  buildStockForecast,
  FORECAST_HORIZON_DAYS,
  forecastStartDate,
  type MedicationForecast,
} from '../stock-forecast';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type { KnownPreparation } from '@/domain/preparations/preparation';
import type {
  PhaseFrequency,
  Treatment,
  TreatmentPhase,
} from '@/domain/treatments/treatment';

const TODAY = '2026-08-09';

const phase = (overrides: Partial<TreatmentPhase> = {}): TreatmentPhase =>
  ({
    id: 1,
    startDate: '2026-01-01',
    endDate: null,
    frequency: { type: 'daily' } satisfies PhaseFrequency,
    dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
    ...overrides,
  }) as TreatmentPhase;

const treatment = (overrides: Partial<Treatment> = {}): Treatment => ({
  id: 1,
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  includedInPillbox: true,
  archivedAt: null,
  phases: [phase()],
  ...overrides,
});

const box = (overrides: Partial<MedicationBox> = {}): MedicationBox => ({
  id: 1,
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  presentationCip13: '3400000000001',
  presentationLabel: 'Boîte',
  lot: 'LOT-A',
  expirationDate: '2027-01-01',
  initialQuantity: 30,
  remainingQuantity: 30,
  origin: 'SCAN',
  scanRaw: 'raw',
  ...overrides,
});

const only = (
  treatments: readonly Treatment[],
  boxes: readonly MedicationBox[],
  preparations: readonly KnownPreparation[] = [],
  options?: Readonly<{ horizonDays?: number }>,
): MedicationForecast => {
  const forecast = buildStockForecast(
    treatments,
    boxes,
    TODAY,
    preparations,
    options,
  );
  expect(forecast.medications).toHaveLength(1);
  return forecast.medications[0];
};

describe('date de départ de la prévision', () => {
  it('démarre demain lorsque aucune préparation n’a été validée', () => {
    expect(forecastStartDate(TODAY, [])).toBe('2026-08-10');
  });

  it('démarre après le dernier jour déjà couvert par une préparation validée', () => {
    const known: KnownPreparation[] = [
      { id: 1, startDate: '2026-08-10', status: 'COMPLETED' },
    ];
    expect(forecastStartDate(TODAY, known)).toBe('2026-08-17');
  });

  it('retient la préparation validée la plus lointaine', () => {
    const known: KnownPreparation[] = [
      { id: 1, startDate: '2026-08-17', status: 'COMPLETED' },
      { id: 2, startDate: '2026-08-10', status: 'COMPLETED' },
    ];
    expect(forecastStartDate(TODAY, known)).toBe('2026-08-24');
  });

  it('ignore une préparation en cours, dont le stock n’est pas encore décrémenté', () => {
    const known: KnownPreparation[] = [
      { id: 1, startDate: '2026-08-10', status: 'DRAFT' },
    ];
    expect(forecastStartDate(TODAY, known)).toBe('2026-08-10');
  });

  it('ignore une préparation validée déjà terminée dans le passé', () => {
    const known: KnownPreparation[] = [
      { id: 1, startDate: '2026-07-01', status: 'COMPLETED' },
    ];
    expect(forecastStartDate(TODAY, known)).toBe('2026-08-10');
  });
});

describe('prévision de consommation', () => {
  it('documente l’horizon de simulation', () => {
    expect(FORECAST_HORIZON_DAYS).toBe(14);
  });

  it('expose la période couverte par la prochaine préparation', () => {
    const forecast = buildStockForecast([treatment()], [box()], TODAY, []);
    expect(forecast).toMatchObject({
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      horizonEndDate: '2026-08-23',
    });
  });

  it('calcule la rupture d’une posologie quotidienne', () => {
    expect(only([treatment()], [box({ remainingQuantity: 10 })])).toMatchObject(
      {
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
      },
    );
  });

  it('calcule la rupture d’une prise tous les deux jours ancrée à une date connue', () => {
    const everyTwoDays = treatment({
      phases: [
        phase({
          frequency: {
            type: 'interval',
            everyNDays: 2,
            anchorDate: '2026-08-10',
          },
        }),
      ],
    });
    expect(only([everyTwoDays], [box({ remainingQuantity: 3 })])).toMatchObject(
      {
        availableHalfUnits: 6,
        nextPreparationHalfUnits: 8,
        missingHalfUnits: 2,
        insufficientForNextPreparation: true,
        coverage: { status: 'RUNS_OUT', date: '2026-08-16', coveredDays: 6 },
      },
    );
  });

  it('calcule la rupture d’une prise tous les trois jours', () => {
    const everyThreeDays = treatment({
      phases: [
        phase({
          frequency: {
            type: 'interval',
            everyNDays: 3,
            anchorDate: '2026-08-10',
          },
        }),
      ],
    });
    expect(
      only([everyThreeDays], [box({ remainingQuantity: 2 })]).coverage,
    ).toMatchObject({ status: 'RUNS_OUT', date: '2026-08-16', coveredDays: 6 });
  });

  it('calcule la rupture d’une prise hebdomadaire', () => {
    const weekly = treatment({
      phases: [phase({ frequency: { type: 'weekly', weekday: 'monday' } })],
    });
    // Une seule unité : la prise du 10 août l'épuise, celle du 17 manque.
    expect(only([weekly], [box({ remainingQuantity: 1 })])).toMatchObject({
      nextPreparationHalfUnits: 2,
      coverage: { status: 'RUNS_OUT', date: '2026-08-17', coveredDays: 7 },
    });
  });

  it('ne cherche pas de rupture au-delà des deux prochains cycles', () => {
    const weekly = treatment({
      phases: [phase({ frequency: { type: 'weekly', weekday: 'monday' } })],
    });
    // La rupture du 24 août tombe juste après la fenêtre : rien n'est annoncé
    // plutôt qu'une date que la fenêtre ne permet pas de confirmer.
    expect(only([weekly], [box({ remainingQuantity: 2 })]).coverage).toEqual({
      status: 'BEYOND_HORIZON',
      horizonDays: FORECAST_HORIZON_DAYS,
    });
  });

  it('tient compte du changement de phase à la date exacte', () => {
    const evolving = treatment({
      phases: [
        phase({ id: 1, startDate: '2026-08-10', endDate: '2026-08-12' }),
        phase({
          id: 2,
          startDate: '2026-08-13',
          endDate: null,
          dosage: [{ slot: 'morning', quantityHalfUnits: 4 }],
        }),
      ],
    });
    // 3 jours à 1 comprimé (10, 11, 12) puis 2 comprimés par jour : les 7
    // comprimés disponibles couvrent jusqu'au 14 août inclus.
    expect(only([evolving], [box({ remainingQuantity: 7 })])).toMatchObject({
      availableHalfUnits: 14,
      nextPreparationHalfUnits: 22,
      coverage: { status: 'RUNS_OUT', date: '2026-08-15', coveredDays: 5 },
    });
  });

  it('compte les demi-comprimés sans arrondi', () => {
    const half = treatment({
      phases: [phase({ dosage: [{ slot: 'evening', quantityHalfUnits: 1 }] })],
    });
    expect(only([half], [box({ remainingQuantity: 3 })])).toMatchObject({
      availableHalfUnits: 6,
      nextPreparationHalfUnits: 7,
      missingHalfUnits: 1,
      coverage: { status: 'RUNS_OUT', date: '2026-08-16', coveredDays: 6 },
    });
  });

  it('n’utilise jamais une boîte déjà périmée', () => {
    expect(
      only([treatment()], [box({ expirationDate: '2026-08-09' })]),
    ).toMatchObject({
      availableHalfUnits: 0,
      missingHalfUnits: 14,
      insufficientForNextPreparation: true,
      coverage: {
        status: 'RUNS_OUT',
        date: '2026-08-10',
        cause: 'CONSUMED',
        coveredDays: 0,
      },
    });
  });

  it('retire le reliquat d’une boîte qui périme pendant la période couverte', () => {
    const forecast = only(
      [treatment()],
      [
        box({ id: 1, remainingQuantity: 20, expirationDate: '2026-08-14' }),
        box({
          id: 2,
          lot: 'LOT-B',
          remainingQuantity: 2,
          expirationDate: '2027-01-01',
        }),
      ],
    );
    expect(forecast).toMatchObject({
      availableHalfUnits: 44,
      coverage: {
        status: 'RUNS_OUT',
        date: '2026-08-17',
        cause: 'EXPIRED',
        coveredDays: 7,
      },
    });
  });

  it('consomme les boîtes en FEFO avant celles qui périment plus tard', () => {
    const forecast = only(
      [treatment()],
      [
        box({ id: 1, remainingQuantity: 2, expirationDate: '2027-01-01' }),
        box({
          id: 2,
          lot: 'LOT-B',
          remainingQuantity: 2,
          expirationDate: '2026-09-01',
        }),
      ],
    );
    // La boîte 2 périme en premier : elle est consommée d'abord et rien n'est
    // perdu, la rupture vient donc de l'épuisement du stock.
    expect(forecast.coverage).toMatchObject({
      status: 'RUNS_OUT',
      date: '2026-08-14',
      cause: 'CONSUMED',
      coveredDays: 4,
    });
  });

  it('signale une rupture immédiate lorsque le stock est nul', () => {
    expect(only([treatment()], [])).toMatchObject({
      availableHalfUnits: 0,
      nextPreparationHalfUnits: 14,
      missingHalfUnits: 14,
      insufficientForNextPreparation: true,
      coverage: { status: 'RUNS_OUT', date: '2026-08-10', coveredDays: 0 },
    });
  });

  it('n’annonce pas de date lorsque le stock dépasse l’horizon de simulation', () => {
    expect(
      only(
        [treatment()],
        [box({ remainingQuantity: 400, expirationDate: '2028-01-01' })],
      ).coverage,
    ).toEqual({ status: 'BEYOND_HORIZON', horizonDays: FORECAST_HORIZON_DAYS });
  });

  it('n’annonce pas de date lorsque aucune prise n’est prévue', () => {
    const finished = treatment({
      phases: [phase({ startDate: '2026-01-01', endDate: '2026-06-30' })],
    });
    expect(only([finished], [box({ remainingQuantity: 10 })])).toMatchObject({
      nextPreparationHalfUnits: 0,
      missingHalfUnits: 0,
      insufficientForNextPreparation: false,
      coverage: { status: 'NO_FUTURE_INTAKE' },
    });
  });

  it('conserve un traitement archivé hors de la prévision mais garde son stock visible', () => {
    const archived = treatment({ archivedAt: '2026-08-01T10:00:00.000Z' });
    expect(only([archived], [box({ remainingQuantity: 10 })]).coverage).toEqual(
      { status: 'NO_FUTURE_INTAKE' },
    );
  });

  it('ne réserve pas deux fois le besoin d’une semaine déjà validée', () => {
    const known: KnownPreparation[] = [
      { id: 1, startDate: '2026-08-10', status: 'COMPLETED' },
    ];
    // Le stock a déjà été décrémenté pour la semaine du 10 au 16 : la prévision
    // repart du 17 et couvre donc dix jours de plus qu'une lecture naïve.
    expect(
      only([treatment()], [box({ remainingQuantity: 10 })], known),
    ).toMatchObject({
      coverage: { status: 'RUNS_OUT', date: '2026-08-27', coveredDays: 10 },
    });
  });

  it('liste un médicament présent en stock sans traitement actif', () => {
    const forecast = buildStockForecast(
      [],
      [box({ specialtyCis: '60000002', specialtyName: 'Beta' })],
      TODAY,
      [],
    );
    expect(forecast.medications).toEqual([
      {
        specialtyCis: '60000002',
        specialtyName: 'Beta',
        availableHalfUnits: 60,
        nextPreparationHalfUnits: 0,
        missingHalfUnits: 0,
        insufficientForNextPreparation: false,
        coverage: { status: 'NO_FUTURE_INTAKE' },
      },
    ]);
  });

  it('trie les médicaments par nom', () => {
    const beta = treatment({
      id: 2,
      specialtyCis: '60000002',
      specialtyName: 'Beta',
    });
    const forecast = buildStockForecast(
      [beta, treatment()],
      [box(), box({ id: 2, specialtyCis: '60000002', specialtyName: 'Beta' })],
      TODAY,
      [],
    );
    expect(forecast.medications.map((item) => item.specialtyName)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('accepte un horizon explicite', () => {
    expect(
      only([treatment()], [box({ remainingQuantity: 400 })], [], {
        horizonDays: 30,
      }).coverage,
    ).toEqual({ status: 'BEYOND_HORIZON', horizonDays: 30 });
  });

  it('refuse un horizon inexploitable', () => {
    expect(() =>
      buildStockForecast([treatment()], [], TODAY, [], { horizonDays: 0 }),
    ).toThrow('horizon');
  });

  it('refuse une date de référence invalide', () => {
    expect(() => buildStockForecast([], [], '09/08/2026', [])).toThrow(
      'Date invalide.',
    );
  });
});
