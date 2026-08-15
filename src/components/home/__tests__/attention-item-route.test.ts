import {
  attentionItemActionLabel,
  attentionItemHref,
} from '../attention-item-route';
import type { AttentionItem } from '@/domain/home/attention-items';

const NEXT_INTAKE: AttentionItem = {
  type: 'NEXT_INTAKE_GROUP',
  id: 'next-intake:1',
  scheduledAt: '2026-08-11T08:00:00.000Z',
  groups: [
    { date: '2026-08-11', slot: 'morning' },
    { date: '2026-08-11', slot: 'noon' },
  ],
  medicationCount: 2,
};

const PREPARATION_START: AttentionItem = {
  type: 'PREPARATION',
  id: 'preparation:next',
  mode: 'START',
  startDate: '2026-08-11',
  endDate: '2026-08-17',
  completedCount: 0,
  totalCount: 0,
};

const RENEWAL: AttentionItem = {
  type: 'STOCK_RENEWAL',
  id: 'stock-renewal:1',
  item: {
    specialtyCis: '1',
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
  },
};

const EXPIRATION: AttentionItem = {
  type: 'EXPIRATION',
  id: 'expiration:7',
  boxId: 7,
  specialtyName: 'Beta',
  lot: 'LOT-B',
  expirationDate: '2026-08-20',
  remainingQuantity: 5,
};

const AS_NEEDED: AttentionItem = {
  type: 'AS_NEEDED_INFO',
  id: 'as-needed:3',
  treatmentId: 3,
  specialtyName: 'Gamma',
  lastIntake: null,
};

describe('attentionItemHref', () => {
  it('ouvre le détail de la prise avec ses groupes sérialisés', () => {
    expect(attentionItemHref(NEXT_INTAKE)).toEqual({
      pathname: '/intakes/planned',
      params: { groups: '2026-08-11:morning,2026-08-11:noon' },
    });
  });

  it('ouvre la préparation guidée pour démarrer ou reprendre', () => {
    expect(attentionItemHref(PREPARATION_START)).toBe('/preparations/new');
    expect(attentionItemHref({ ...PREPARATION_START, mode: 'RESUME' })).toBe(
      '/preparations/new',
    );
  });

  it("ouvre l'historique quand la préparation est déjà prête", () => {
    expect(attentionItemHref({ ...PREPARATION_START, mode: 'READY' })).toBe(
      '/preparations/history',
    );
  });

  it('ouvre le stock filtré sur « à renouveler »', () => {
    expect(attentionItemHref(RENEWAL)).toEqual({
      pathname: '/inventory',
      params: { filter: 'renew' },
    });
  });

  it('ouvre la boîte concernée par la péremption', () => {
    expect(attentionItemHref(EXPIRATION)).toEqual({
      pathname: '/inventory/[id]',
      params: { id: '7' },
    });
  });

  it('ouvre le traitement si besoin concerné', () => {
    expect(attentionItemHref(AS_NEEDED)).toEqual({
      pathname: '/treatments/[id]',
      params: { id: '3' },
    });
  });
});

describe('attentionItemActionLabel', () => {
  it('distingue démarrer, reprendre et consulter selon le mode de préparation', () => {
    expect(attentionItemActionLabel(PREPARATION_START)).toBe(
      'Commencer la préparation',
    );
    expect(
      attentionItemActionLabel({ ...PREPARATION_START, mode: 'RESUME' }),
    ).toBe('Reprendre la préparation');
    expect(
      attentionItemActionLabel({ ...PREPARATION_START, mode: 'READY' }),
    ).toBe('Voir l’historique des préparations');
  });

  it('donne un libellé explicite pour chaque autre type de carte', () => {
    expect(attentionItemActionLabel(NEXT_INTAKE)).toBe(
      'Voir le détail de la prise',
    );
    expect(attentionItemActionLabel(RENEWAL)).toBe('Voir le stock');
    expect(attentionItemActionLabel(EXPIRATION)).toBe('Voir la boîte');
    expect(attentionItemActionLabel(AS_NEEDED)).toBe('Voir le traitement');
  });
});
