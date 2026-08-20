import { HomeContent } from '../app/index';
import type { AttentionItem } from '@/domain/home/attention-items';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));

const PREPARATION_START: AttentionItem = {
  type: 'PREPARATION',
  id: 'preparation:next',
  mode: 'START',
  startDate: '2026-08-11',
  endDate: '2026-08-17',
  completedCount: 0,
  totalCount: 0,
};

describe('HomeScreen', () => {
  it('affiche le titre de l’application', () => {
    const rendered = JSON.stringify(
      HomeContent({ items: [PREPARATION_START], loading: false, error: null }),
    );
    expect(rendered).toContain('PillBox');
    expect(rendered).toContain('preparation:next');
  });

  it('affiche un indicateur de chargement tant que la situation n’est pas connue', () => {
    const rendered = JSON.stringify(
      HomeContent({ items: null, loading: true, error: null }),
    );
    expect(rendered).toContain('Chargement de votre situation');
  });

  it('affiche une erreur sans faire disparaître le titre', () => {
    const rendered = JSON.stringify(
      HomeContent({ items: null, loading: false, error: 'Panne locale' }),
    );
    expect(rendered).toContain('Panne locale');
    expect(rendered).toContain('PillBox');
  });

  it('affiche un état calme quand aucune action n’est requise', () => {
    const rendered = JSON.stringify(
      HomeContent({
        items: [{ ...PREPARATION_START, mode: 'READY' }],
        loading: false,
        error: null,
      }),
    );
    expect(rendered).toContain('Tout est en ordre');
  });

  it('ne montre pas l’état calme quand une préparation reste à faire', () => {
    const rendered = JSON.stringify(
      HomeContent({ items: [PREPARATION_START], loading: false, error: null }),
    );
    expect(rendered).not.toContain('Tout est en ordre');
  });

  it('ne montre pas l’état calme quand un renouvellement ou une péremption reste à traiter', () => {
    const items: AttentionItem[] = [
      { ...PREPARATION_START, mode: 'READY' },
      {
        type: 'EXPIRATION',
        id: 'expiration:2',
        boxId: 2,
        specialtyName: 'Beta',
        lot: 'LOT-B',
        expirationDate: '2026-08-20',
        remainingQuantity: 5,
      },
    ];
    const rendered = JSON.stringify(
      HomeContent({ items, loading: false, error: null }),
    );
    expect(rendered).not.toContain('Tout est en ordre');
  });

  it('respecte la priorité : prochaine prise, préparation, renouvellement, péremption, si besoin', () => {
    const items: AttentionItem[] = [
      {
        type: 'NEXT_INTAKE_GROUP',
        id: 'next-intake:1',
        scheduledAt: '2026-08-11T08:00:00.000Z',
        groups: [{ date: '2026-08-11', slot: 'morning' }],
        medicationCount: 1,
      },
      PREPARATION_START,
      {
        type: 'STOCK_RENEWAL',
        id: 'stock-renewal:1',
        item: {
          specialtyCis: '1',
          specialtyName: 'Alpha',
          urgency: 'INSUFFICIENT_FOR_NEXT_PREPARATION',
          availableHalfUnits: 4,
          nextPreparationHalfUnits: 14,
          missingHalfUnits: 10,
          ruptureDate: null,
          ruptureCause: null,
          theoreticalRenewalDate: null,
          theoreticalRenewalWindow: null,
          runsOutBeforeRenewalWindow: false,
          usableBoxCount: null,
        },
      },
      {
        type: 'EXPIRATION',
        id: 'expiration:2',
        boxId: 2,
        specialtyName: 'Beta',
        lot: 'LOT-B',
        expirationDate: '2026-08-20',
        remainingQuantity: 5,
      },
      {
        type: 'AS_NEEDED_INFO',
        id: 'as-needed:3',
        treatmentId: 3,
        specialtyName: 'Gamma',
        lastIntake: null,
      },
    ];
    const rendered = JSON.stringify(
      HomeContent({ items, loading: false, error: null }),
    );
    const order = [
      'next-intake:1',
      'preparation:next',
      'stock-renewal:1',
      'expiration:2',
      'as-needed:3',
    ].map((id) => rendered.indexOf(`"${id}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index]).toBeGreaterThan(order[index - 1]);
    }
  });

  it('n’affiche aucune information de mise à jour quand l’app est à jour', () => {
    const rendered = JSON.stringify(
      HomeContent({ items: [PREPARATION_START], loading: false, error: null }),
    );
    expect(rendered).not.toContain('Mise à jour');
  });

  it('affiche un lien vers la dernière préparation quand elle existe', () => {
    const rendered = JSON.stringify(
      HomeContent({
        items: [PREPARATION_START],
        loading: false,
        error: null,
        lastPreparation: {
          id: 1,
          startDate: '2026-08-04',
          endDate: '2026-08-10',
          completedAt: '2026-08-04T10:00:00.000Z',
          medications: [],
        },
      }),
    );
    expect(rendered).toContain('Validée le');
  });
});
