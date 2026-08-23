import { DailyFinalCheck, dailySlotChecks } from '../daily-final-check';
import type {
  PreparationItemSnapshot,
  PreparationSnapshot,
} from '@/domain/preparations/preparation';

const items: readonly PreparationItemSnapshot[] = [
  {
    treatmentId: 1,
    specialtyCis: '3400000000001',
    specialtyName: 'Ritaline',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-21',
    slot: 'morning',
    quantityHalfUnits: 2,
  },
  {
    treatmentId: 2,
    specialtyCis: '3400000000002',
    specialtyName: 'Zoloft',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-21',
    slot: 'morning',
    quantityHalfUnits: 4,
  },
  {
    treatmentId: 3,
    specialtyCis: '3400000000003',
    specialtyName: 'Doliprane',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-21',
    slot: 'morning',
    quantityHalfUnits: 2,
  },
  {
    treatmentId: 1,
    specialtyCis: '3400000000001',
    specialtyName: 'Ritaline',
    pharmaceuticalForm: 'comprimé',
    date: '2026-08-21',
    slot: 'evening',
    quantityHalfUnits: 1,
  },
];

describe('dailySlotChecks', () => {
  it('regroupe les cases d’un jour par créneau et conserve leur détail', () => {
    expect(dailySlotChecks(items, '2026-08-21')).toEqual([
      {
        slot: 'morning',
        quantityHalfUnits: 8,
        items: items.slice(0, 3),
      },
      {
        slot: 'evening',
        quantityHalfUnits: 1,
        items: [items[3]],
      },
    ]);
  });

  it('rend le jour comme repère principal, avec la date pour chaque case', () => {
    const snapshot: PreparationSnapshot = {
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      items,
      requirements: [],
      hasShortages: false,
    };
    const rendered = JSON.stringify(DailyFinalCheck({ snapshot }));
    expect(rendered).toContain('Lundi');
    expect(rendered).toContain('31 août');
    expect(rendered).toContain('Mardi');
    expect(rendered).toContain('1 septembre');
  });
});
