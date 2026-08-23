import { MedicationStep, type CurrentRequirement } from '../medication-step';
import type { PreparationSnapshot } from '@/domain/preparations/preparation';

const snapshot: PreparationSnapshot = {
  startDate: '2026-08-17',
  endDate: '2026-08-23',
  hasShortages: true,
  requirements: [],
  items: [
    ...['2026-08-17', '2026-08-18', '2026-08-19'].map((date) => ({
      treatmentId: 1,
      specialtyCis: 'A',
      specialtyName: 'Alpha',
      pharmaceuticalForm: 'comprimé',
      date,
      slot: 'morning' as const,
      quantityHalfUnits: 2,
    })),
    {
      treatmentId: 2,
      specialtyCis: 'B',
      specialtyName: 'Beta',
      pharmaceuticalForm: 'comprimé',
      date: '2026-08-17',
      slot: 'morning',
      quantityHalfUnits: 2,
    },
  ],
};

function current(missingHalfUnits: number): CurrentRequirement {
  return {
    specialtyCis: 'A',
    specialtyName: 'Alpha',
    requiredHalfUnits: 6,
    usableStockHalfUnits: 6 - missingHalfUnits,
    missingHalfUnits,
    remainingHalfUnits: 6,
    contributions: [],
  };
}

describe('MedicationStep', () => {
  it('n’affiche aucune attente lorsque le stock couvre toutes les prises', () => {
    const rendered = JSON.stringify(
      MedicationStep({
        snapshot,
        current: current(0),
        boxes: [],
        theoreticalRenewalDate: null,
        pendingComplementEnabled: true,
      }),
    );
    expect(rendered).not.toContain('Stock insuffisant pour toute la semaine');
  });

  it('explique les prises laissées en attente sans date de renouvellement connue', () => {
    const rendered = JSON.stringify(
      MedicationStep({
        snapshot,
        current: current(2),
        boxes: [],
        theoreticalRenewalDate: null,
        pendingComplementEnabled: true,
      }),
    );
    expect(rendered).toContain('2 prises couvertes sur 3');
    expect(rendered).toContain('Mercredi 19 août');
    expect(rendered).not.toContain('pourrait être demandé');
    expect(rendered).not.toContain('Beta');
  });

  it('ajoute la date théorique comme information non garantie lorsqu’elle existe', () => {
    const rendered = JSON.stringify(
      MedicationStep({
        snapshot,
        current: current(2),
        boxes: [],
        theoreticalRenewalDate: '2026-08-25',
        pendingComplementEnabled: true,
      }),
    );
    expect(rendered).toContain('25 août 2026');
    expect(rendered).toContain('ne garantit pas une délivrance');
  });

  it('ne présente pas cet état particulier pour un traitement sans délivrance encadrée', () => {
    const rendered = JSON.stringify(
      MedicationStep({
        snapshot,
        current: current(2),
        boxes: [],
        theoreticalRenewalDate: '2026-08-25',
        pendingComplementEnabled: false,
      }),
    );
    expect(rendered).not.toContain('Stock insuffisant pour toute la semaine');
    expect(rendered).not.toContain('ne garantit pas une délivrance');
  });
});
