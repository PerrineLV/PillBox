import {
  buildWeeklyPillbox,
  type PreparationAttentionItem,
} from '../weekly-pillbox';
import type { Treatment } from '@/domain/treatments/treatment';
import type { SavedPreparation } from '@/infrastructure/preparations/preparation-repository';

const WEEK = { startDate: '2026-03-03', endDate: '2026-03-09' };

function treatment(): Treatment {
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
        endDate: null,
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
    ],
  };
}

function start(): PreparationAttentionItem {
  return {
    type: 'PREPARATION',
    id: 'preparation:next',
    mode: 'START',
    ...WEEK,
    completedCount: 0,
    totalCount: 0,
  };
}

function draft(): SavedPreparation {
  return {
    id: 7,
    snapshot: {
      ...WEEK,
      hasShortages: false,
      requirements: [],
      items: [
        {
          treatmentId: 1,
          specialtyCis: '60000001',
          specialtyName: 'Levothyrox 50 µg',
          pharmaceuticalForm: 'comprimé',
          date: '2026-03-03',
          slot: 'morning',
          quantityHalfUnits: 2,
        },
      ],
    },
    progress: [],
  };
}

describe('pilulier de la semaine sur l’accueil', () => {
  it('disparaît quand il n’y a rien à préparer', () => {
    expect(
      buildWeeklyPillbox({
        preparation: undefined,
        draft: null,
        treatments: [treatment()],
      }),
    ).toBeNull();
  });

  it('propose la semaine à préparer le jour du rappel', () => {
    const pillbox = buildWeeklyPillbox({
      preparation: start(),
      draft: null,
      treatments: [treatment()],
    });
    expect(pillbox?.state).toBe('TO_PREPARE');
    expect(pillbox?.grid.startDate).toBe(WEEK.startDate);
    expect(pillbox?.grid.totalCases).toBe(7);
  });

  it('montre l’avancement d’une préparation en cours, d’après son snapshot', () => {
    const saved = draft();
    const pillbox = buildWeeklyPillbox({
      preparation: { ...start(), mode: 'RESUME' },
      draft: saved,
      // Un traitement modifié depuis ne doit pas redessiner la grille.
      treatments: [],
    });
    expect(pillbox?.state).toBe('IN_PROGRESS');
    expect(pillbox?.grid.totalCases).toBe(1);
  });

  it('n’affiche rien pour une semaine sans aucune prise prévue', () => {
    expect(
      buildWeeklyPillbox({
        preparation: start(),
        draft: null,
        treatments: [],
      }),
    ).toBeNull();
  });
});
