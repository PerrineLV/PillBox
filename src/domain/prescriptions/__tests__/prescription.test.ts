import {
  comparePrescriptionsForList,
  computePrescriptionStatus,
  computeTheoreticalRenewalDate,
  isPrescriptionValidityApproaching,
  suggestedToleranceDays,
  theoreticalRenewalWindow,
  type Prescription,
} from '../prescription';

function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: 1,
    label: 'Ordo',
    issueDate: '2026-01-01',
    validUntil: '2026-12-01',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('computePrescriptionStatus', () => {
  it('est ACTIVE tant que la date du jour ne dépasse pas validUntil', () => {
    expect(
      computePrescriptionStatus(
        { validUntil: '2026-12-01' },
        false,
        '2026-08-14',
      ),
    ).toBe('ACTIVE');
  });

  it('est EXPIRED une fois validUntil dépassée', () => {
    expect(
      computePrescriptionStatus(
        { validUntil: '2026-01-01' },
        false,
        '2026-08-14',
      ),
    ).toBe('EXPIRED');
  });

  it('reste ACTIVE indéfiniment quand validUntil est inconnue', () => {
    expect(
      computePrescriptionStatus({ validUntil: null }, false, '2099-01-01'),
    ).toBe('ACTIVE');
  });

  it('est REPLACED dès qu’un remplacement est confirmé, même encore valide', () => {
    expect(
      computePrescriptionStatus(
        { validUntil: '2026-12-01' },
        true,
        '2026-08-14',
      ),
    ).toBe('REPLACED');
  });
});

describe('computeTheoreticalRenewalDate', () => {
  it('ajoute la périodicité en jours à la dernière délivrance', () => {
    expect(computeTheoreticalRenewalDate('2026-08-01', 28)).toBe('2026-08-29');
  });

  it('rejette une date de dernière délivrance invalide', () => {
    expect(() => computeTheoreticalRenewalDate('01/08/2026', 28)).toThrow(
      'dernière délivrance',
    );
  });

  it('rejette une périodicité non positive', () => {
    expect(() => computeTheoreticalRenewalDate('2026-08-01', 0)).toThrow(
      'périodicité',
    );
  });
});

describe('suggestedToleranceDays', () => {
  it('ne suggère rien pour une spécialité détectée stupéfiant', () => {
    expect(suggestedToleranceDays(true)).toBeNull();
  });

  it('suggère une valeur raisonnable pour les autres spécialités', () => {
    expect(suggestedToleranceDays(false)).toBe(3);
  });
});

describe('theoreticalRenewalWindow', () => {
  it('réduit la fenêtre à la date exacte sans tolérance', () => {
    expect(theoreticalRenewalWindow('2026-01-29', null)).toEqual({
      start: '2026-01-29',
      end: '2026-01-29',
    });
    expect(theoreticalRenewalWindow('2026-01-29', 0)).toEqual({
      start: '2026-01-29',
      end: '2026-01-29',
    });
  });

  it('encadre la date théorique de la tolérance donnée', () => {
    expect(theoreticalRenewalWindow('2026-01-29', 3)).toEqual({
      start: '2026-01-26',
      end: '2026-02-01',
    });
  });
});

describe('isPrescriptionValidityApproaching', () => {
  it('signale une ordonnance active dont la fin de validité approche', () => {
    expect(
      isPrescriptionValidityApproaching(
        prescription({ status: 'ACTIVE', validUntil: '2026-08-20' }),
        '2026-08-14',
      ),
    ).toBe(true);
  });

  it('ne signale rien tant que la fenêtre d’approche n’est pas atteinte', () => {
    expect(
      isPrescriptionValidityApproaching(
        prescription({ status: 'ACTIVE', validUntil: '2026-12-01' }),
        '2026-08-14',
      ),
    ).toBe(false);
  });

  it('ne signale jamais une ordonnance sans fin de validité connue', () => {
    expect(
      isPrescriptionValidityApproaching(
        prescription({ status: 'ACTIVE', validUntil: null }),
        '2026-08-14',
      ),
    ).toBe(false);
  });

  it('ne signale jamais une ordonnance EXPIRED ou REPLACED', () => {
    expect(
      isPrescriptionValidityApproaching(
        prescription({ status: 'EXPIRED', validUntil: '2026-08-20' }),
        '2026-08-14',
      ),
    ).toBe(false);
    expect(
      isPrescriptionValidityApproaching(
        prescription({ status: 'REPLACED', validUntil: '2026-08-20' }),
        '2026-08-14',
      ),
    ).toBe(false);
  });

  it('accepte un seuil personnalisé', () => {
    expect(
      isPrescriptionValidityApproaching(
        prescription({ status: 'ACTIVE', validUntil: '2026-08-20' }),
        '2026-08-14',
        5,
      ),
    ).toBe(false);
  });
});

describe('comparePrescriptionsForList', () => {
  it('place les ordonnances actives avant les autres', () => {
    const active = prescription({ id: 1, status: 'ACTIVE' });
    const expired = prescription({ id: 2, status: 'EXPIRED' });

    expect([expired, active].sort(comparePrescriptionsForList)).toEqual([
      active,
      expired,
    ]);
  });

  it('trie à statut égal par fin de validité croissante', () => {
    const soon = prescription({ id: 1, validUntil: '2026-09-01' });
    const later = prescription({ id: 2, validUntil: '2026-12-01' });

    expect([later, soon].sort(comparePrescriptionsForList)).toEqual([
      soon,
      later,
    ]);
  });

  it('place une fin de validité inconnue après toute date connue', () => {
    const unknown = prescription({ id: 1, validUntil: null });
    const known = prescription({ id: 2, validUntil: '2026-09-01' });

    expect([unknown, known].sort(comparePrescriptionsForList)).toEqual([
      known,
      unknown,
    ]);
  });
});
