import {
  buildWeeklyGrid,
  type WeeklyGridItem,
} from '@/domain/home/weekly-grid';
import { addCivilDays } from '@/domain/shared/dates';
import type { IntakeSlot } from '@/domain/treatments/treatment';

const START = '2026-08-31';

function week(
  slot: IntakeSlot,
  specialtyCis: string,
  days = 7,
): WeeklyGridItem[] {
  return Array.from({ length: days }, (_, index) => ({
    date: addCivilDays(START, index),
    slot,
    specialtyCis,
  }));
}

describe('grille de la semaine', () => {
  const items = [
    ...week('morning', '60000001'),
    ...week('noon', '60000002'),
    ...week('noon', '60000003'),
    ...week('evening', '60000003'),
  ];

  it('n’ouvre une ligne que pour les créneaux servis', () => {
    expect(buildWeeklyGrid({ startDate: START, items }).slots).toEqual([
      'morning',
      'noon',
      'evening',
    ]);
  });

  it('compte une case par médicament et par jour', () => {
    const grid = buildWeeklyGrid({ startDate: START, items });
    expect(grid.totalCases).toBe(28);
    expect(grid.preparedCases).toBe(0);
    expect(grid.rows).toHaveLength(3);
    expect(grid.rows[0]).toHaveLength(7);
  });

  it('ne déclare une case prête que si tous ses médicaments sont déposés', () => {
    const grid = buildWeeklyGrid({
      startDate: START,
      items,
      preparedCis: ['60000001', '60000002'],
    });
    expect(grid.preparedCases).toBe(14);
    expect(grid.rows[0][0]).toBe('READY');
    // Le midi porte aussi 60000003, encore à déposer.
    expect(grid.rows[1][0]).toBe('TO_PREPARE');
  });

  it('laisse vide un jour sans prise, sans le compter comme à préparer', () => {
    const grid = buildWeeklyGrid({
      startDate: START,
      items: week('morning', '60000001', 3),
    });
    expect(grid.rows[0]).toEqual([
      'TO_PREPARE',
      'TO_PREPARE',
      'TO_PREPARE',
      'EMPTY',
      'EMPTY',
      'EMPTY',
      'EMPTY',
    ]);
    expect(grid.totalCases).toBe(3);
  });

  it('ignore une prise hors de la semaine affichée', () => {
    const grid = buildWeeklyGrid({
      startDate: START,
      items: [
        ...week('morning', '60000001', 7),
        {
          date: addCivilDays(START, 7),
          slot: 'morning',
          specialtyCis: '60000001',
        },
      ],
    });
    expect(grid.totalCases).toBe(7);
    expect(grid.days).toHaveLength(7);
  });
});
