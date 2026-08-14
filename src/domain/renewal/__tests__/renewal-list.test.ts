import { buildRenewalList } from '../renewal-list';
import type {
  ForecastCoverage,
  MedicationForecast,
  StockForecast,
} from '@/domain/forecast/stock-forecast';
import type { PrescriptionItem } from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';

function coverageRunsOut(
  overrides: Partial<Extract<ForecastCoverage, { status: 'RUNS_OUT' }>> = {},
): ForecastCoverage {
  return {
    status: 'RUNS_OUT',
    date: '2026-01-10',
    cause: 'CONSUMED',
    coveredDays: 3,
    ...overrides,
  };
}

function medication(
  overrides: Partial<MedicationForecast> = {},
): MedicationForecast {
  return {
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    availableHalfUnits: 10,
    nextPreparationHalfUnits: 14,
    missingHalfUnits: 0,
    insufficientForNextPreparation: false,
    coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 },
    ...overrides,
  } satisfies MedicationForecast;
}

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: null,
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    ...overrides,
  } satisfies Treatment;
}

function prescriptionItem(
  overrides: Partial<PrescriptionItem> = {},
): PrescriptionItem {
  return {
    id: 1,
    prescriptionId: 1,
    treatmentId: 1,
    quantityKind: 'DURATION',
    durationDays: 28,
    boxCount: null,
    dispensingMode: 'FRACTIONAL',
    periodicityDays: 28,
    lastDispensedAt: '2026-01-01',
    theoreticalRenewalDate: '2026-01-29',
    toleranceDays: null,
    ...overrides,
  } satisfies PrescriptionItem;
}

function forecast(
  medications: readonly MedicationForecast[],
  overrides: Partial<StockForecast> = {},
): StockForecast {
  return {
    startDate: '2026-01-01',
    endDate: '2026-01-07',
    horizonDays: 14,
    horizonEndDate: '2026-01-14',
    medications,
    ...overrides,
  } satisfies StockForecast;
}

describe('buildRenewalList', () => {
  it('classe un médicament insuffisant pour la prochaine préparation, même sans date de rupture connue', () => {
    const [item] = buildRenewalList(
      forecast([
        medication({
          insufficientForNextPreparation: true,
          missingHalfUnits: 4,
          coverage: { status: 'NO_FUTURE_INTAKE' },
        }),
      ]),
    );

    expect(item.urgency).toBe('INSUFFICIENT_FOR_NEXT_PREPARATION');
    expect(item.ruptureDate).toBeNull();
    expect(item.missingHalfUnits).toBe(4);
  });

  it('classe en rupture proche une rupture prévue avant la fin de la prochaine préparation', () => {
    const [item] = buildRenewalList(
      forecast([
        medication({ coverage: coverageRunsOut({ date: '2026-01-07' }) }),
      ]),
    );

    expect(item.urgency).toBe('RUNS_OUT_SOON');
    expect(item.ruptureDate).toBe('2026-01-07');
  });

  it('classe en stock faible une rupture prévue après la fin de la prochaine préparation', () => {
    const [item] = buildRenewalList(
      forecast([
        medication({ coverage: coverageRunsOut({ date: '2026-01-08' }) }),
      ]),
    );

    expect(item.urgency).toBe('LOW_STOCK');
  });

  it('exclut un médicament couvert sur tout l’horizon ou sans prise future', () => {
    const items = buildRenewalList(
      forecast([
        medication({
          specialtyCis: '1',
          coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 },
        }),
        medication({
          specialtyCis: '2',
          coverage: { status: 'NO_FUTURE_INTAKE' },
        }),
      ]),
    );

    expect(items).toHaveLength(0);
  });

  it('trie par urgence, puis par proximité de rupture, puis par quantité manquante', () => {
    const items = buildRenewalList(
      forecast([
        medication({
          specialtyCis: 'low-stock',
          specialtyName: 'Stock faible',
          coverage: coverageRunsOut({ date: '2026-01-12' }),
        }),
        medication({
          specialtyCis: 'insufficient-small',
          specialtyName: 'Insuffisant petit manque',
          insufficientForNextPreparation: true,
          missingHalfUnits: 2,
        }),
        medication({
          specialtyCis: 'runs-out-soon',
          specialtyName: 'Rupture proche',
          coverage: coverageRunsOut({ date: '2026-01-05' }),
        }),
        medication({
          specialtyCis: 'insufficient-large',
          specialtyName: 'Insuffisant grand manque',
          insufficientForNextPreparation: true,
          missingHalfUnits: 8,
        }),
      ]),
    );

    expect(items.map((item) => item.specialtyCis)).toEqual([
      'insufficient-large',
      'insufficient-small',
      'runs-out-soon',
      'low-stock',
    ]);
  });

  it('recalcule naturellement : le stock ajouté fait disparaître le médicament de la liste', () => {
    const before = buildRenewalList(
      forecast([
        medication({
          availableHalfUnits: 4,
          nextPreparationHalfUnits: 14,
          missingHalfUnits: 10,
          insufficientForNextPreparation: true,
        }),
      ]),
    );
    expect(before).toHaveLength(1);

    const after = buildRenewalList(
      forecast([
        medication({
          availableHalfUnits: 20,
          nextPreparationHalfUnits: 14,
          missingHalfUnits: 0,
          insufficientForNextPreparation: false,
          coverage: { status: 'BEYOND_HORIZON', horizonDays: 14 },
        }),
      ]),
    );
    expect(after).toHaveLength(0);
  });

  it('n’attache aucune date théorique sans traitement fourni', () => {
    const [item] = buildRenewalList(
      forecast([medication({ coverage: coverageRunsOut() })]),
    );

    expect(item.theoreticalRenewalDate).toBeNull();
  });

  it('joint la date théorique d’une ligne d’ordonnance FRACTIONAL, sans changer l’urgence ni le tri', () => {
    const [item] = buildRenewalList(
      forecast([
        medication({ coverage: coverageRunsOut({ date: '2026-01-05' }) }),
      ]),
      [treatment()],
      [prescriptionItem()],
    );

    expect(item.theoreticalRenewalDate).toBe('2026-01-29');
    expect(item.urgency).toBe('RUNS_OUT_SOON');
  });

  it('ignore la date théorique d’une ligne en mode FULL', () => {
    const [item] = buildRenewalList(
      forecast([medication({ coverage: coverageRunsOut() })]),
      [treatment()],
      [
        prescriptionItem({
          dispensingMode: 'FULL',
          periodicityDays: null,
          lastDispensedAt: null,
          theoreticalRenewalDate: null,
          toleranceDays: null,
        }),
      ],
    );

    expect(item.theoreticalRenewalDate).toBeNull();
  });

  it('ignore une ligne d’ordonnance sans rapport avec un autre CIS', () => {
    const [item] = buildRenewalList(
      forecast([medication({ coverage: coverageRunsOut() })]),
      [treatment({ id: 2, specialtyCis: 'autre-cis' })],
      [prescriptionItem({ treatmentId: 2 })],
    );

    expect(item.theoreticalRenewalDate).toBeNull();
  });
});
