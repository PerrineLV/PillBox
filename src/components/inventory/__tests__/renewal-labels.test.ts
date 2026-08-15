import {
  renewalAvailabilityLabel,
  renewalRunsOutBeforeWindowLabel,
  renewalTheoreticalRenewalLabel,
} from '../renewal-labels';
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
    theoreticalRenewalWindow: null,
    runsOutBeforeRenewalWindow: false,
    usableBoxCount: null,
    ...overrides,
  } satisfies RenewalItem;
}

describe('renewalTheoreticalRenewalLabel', () => {
  it('retourne `null` sans délivrance encadrée', () => {
    expect(renewalTheoreticalRenewalLabel(item())).toBeNull();
  });

  it('affiche la date exacte sans fenêtre (ex. stupéfiants, sans tolérance)', () => {
    const label = renewalTheoreticalRenewalLabel(
      item({
        theoreticalRenewalDate: '2026-08-29',
        theoreticalRenewalWindow: { start: '2026-08-29', end: '2026-08-29' },
      }),
    );
    expect(label).toContain('29 août 2026');
    expect(label).toContain('Renouvellement théorique');
  });

  it('affiche la fenêtre complète quand une tolérance est renseignée', () => {
    const label = renewalTheoreticalRenewalLabel(
      item({
        theoreticalRenewalDate: '2026-08-29',
        theoreticalRenewalWindow: { start: '2026-08-26', end: '2026-09-01' },
      }),
    );
    expect(label).toContain('26 août 2026');
    expect(label).toContain('1 septembre 2026');
    expect(label).not.toContain('29 août 2026');
  });
});

describe('renewalRunsOutBeforeWindowLabel', () => {
  it('retourne `null` sans rupture avant la fenêtre', () => {
    expect(renewalRunsOutBeforeWindowLabel(item())).toBeNull();
  });

  it('signale clairement une rupture prévue avant le début de la fenêtre', () => {
    const label = renewalRunsOutBeforeWindowLabel(
      item({
        runsOutBeforeRenewalWindow: true,
        theoreticalRenewalWindow: { start: '2026-08-26', end: '2026-09-01' },
      }),
    );
    expect(label).toContain('26 août 2026');
    expect(label).toContain('avant de pouvoir renouveler');
  });
});

describe('renewalAvailabilityLabel', () => {
  it('décrit le nombre de boîtes utilisables pour une ligne BOX_COUNT', () => {
    expect(renewalAvailabilityLabel(item({ usableBoxCount: 1 }))).toBe(
      '1 boîte utilisable(s) en stock.',
    );
    expect(renewalAvailabilityLabel(item({ usableBoxCount: 0 }))).toBe(
      'Plus aucune boîte utilisable en stock.',
    );
  });
});
