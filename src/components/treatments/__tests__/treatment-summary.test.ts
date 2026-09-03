import {
  currentPhase,
  phaseSlotQuantities,
  treatmentCategory,
  treatmentPosologySummary,
} from '../treatment-summary';
import type { Treatment } from '@/domain/treatments/treatment';

function treatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Levothyrox 50 µg',
    pharmaceuticalForm: 'comprimé',
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    phases: [
      {
        id: 1,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
      {
        id: 2,
        startDate: '2026-07-01',
        endDate: null,
        frequency: { type: 'daily' },
        dosage: [
          { slot: 'morning', quantityHalfUnits: 3 },
          { slot: 'evening', quantityHalfUnits: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('résumé d’un traitement', () => {
  it('classe le traitement selon la façon dont la prise est suivie', () => {
    expect(treatmentCategory(treatment())).toBe('PILLBOX');
    expect(treatmentCategory(treatment({ includedInPillbox: false }))).toBe(
      'OUTSIDE',
    );
    expect(treatmentCategory(treatment({ dosageKind: 'AS_NEEDED' }))).toBe(
      'AS_NEEDED',
    );
  });

  it('n’invente aucune posologie pour un traitement si besoin', () => {
    expect(
      treatmentPosologySummary(
        treatment({ dosageKind: 'AS_NEEDED', phases: [] }),
      ),
    ).toBe('Pris ponctuellement, sans posologie planifiée.');
  });

  it('retient la phase en vigueur à la date donnée', () => {
    expect(currentPhase(treatment(), '2026-03-15')?.id).toBe(1);
    expect(currentPhase(treatment(), '2026-09-02')?.id).toBe(2);
    expect(currentPhase(treatment(), '2025-12-31')).toBeNull();
  });

  it('additionne les quantités par créneau de la phase', () => {
    expect(
      phaseSlotQuantities(currentPhase(treatment(), '2026-09-02')),
    ).toEqual({ morning: 3, noon: 0, evening: 1, bedtime: 0 });
  });

  it('ne sert aucun créneau sans phase en vigueur', () => {
    expect(phaseSlotQuantities(null)).toEqual({
      morning: 0,
      noon: 0,
      evening: 0,
      bedtime: 0,
    });
  });
});
