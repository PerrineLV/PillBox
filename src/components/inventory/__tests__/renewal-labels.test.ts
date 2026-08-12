import { renewalTheoreticalRenewalLabel } from '../renewal-labels';
import type { RenewalItem } from '@/domain/renewal/renewal-list';

function item(overrides: Partial<RenewalItem> = {}): RenewalItem {
  return {
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    urgency: 'RUNS_OUT_SOON',
    availableHalfUnits: 4,
    nextPreparationHalfUnits: 14,
    missingHalfUnits: 0,
    ruptureDate: '2026-08-15',
    ruptureCause: 'CONSUMED',
    theoreticalRenewalDate: null,
    ...overrides,
  } satisfies RenewalItem;
}

describe('renewalTheoreticalRenewalLabel', () => {
  it('retourne `null` sans délivrance encadrée', () => {
    expect(renewalTheoreticalRenewalLabel(item())).toBeNull();
  });

  it('affiche la date théorique sans mention d’urgence ni de blocage', () => {
    const label = renewalTheoreticalRenewalLabel(
      item({ theoreticalRenewalDate: '2026-08-29' }),
    );
    expect(label).toContain('29 août 2026');
    expect(label).toContain('Renouvellement théorique');
  });
});
