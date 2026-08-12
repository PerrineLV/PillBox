import type { ScheduledTreatmentPhase } from '@/domain/treatments/treatment';

import { PhaseEditor, initialPhases, nextPhase } from '../treatment-form';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const PHASE: ScheduledTreatmentPhase = {
  id: null,
  startDate: '2026-08-10',
  endDate: null,
  frequency: { type: 'daily' },
  dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
};

function render(phase: ScheduledTreatmentPhase): string {
  return JSON.stringify(
    PhaseEditor({
      number: 1,
      phase,
      onChange: jest.fn(),
      onRemove: jest.fn(),
    }),
  );
}

describe('phases proposées à l’ouverture du formulaire', () => {
  it('propose une phase 1 vide prête à remplir', () => {
    const phases = initialPhases([]);
    expect(phases).toHaveLength(1);
    expect(phases[0]).toEqual({
      id: null,
      startDate: '',
      endDate: null,
      frequency: { type: 'daily' },
      dosage: [],
    });
  });

  it('n’ajoute jamais de phase vide supplémentaire à une phase existante', () => {
    expect(initialPhases([PHASE])).toEqual([PHASE]);
  });

  it('conserve toutes les phases déjà enregistrées', () => {
    const second: ScheduledTreatmentPhase = {
      ...PHASE,
      startDate: '2026-09-01',
    };
    const third: ScheduledTreatmentPhase = {
      ...PHASE,
      startDate: '2026-10-01',
    };
    expect(initialPhases([PHASE, second, third])).toHaveLength(3);
  });
});

describe('phase ajoutée après une phase existante', () => {
  it('démarre le lendemain de la date de fin saisie', () => {
    const added = nextPhase([{ ...PHASE, endDate: '2026-08-31' }]);
    expect(added.startDate).toBe('2026-09-01');
    expect(added.endDate).toBeNull();
    expect(added.dosage).toEqual([]);
  });

  it('retient la fin la plus tardive quand plusieurs phases existent', () => {
    const added = nextPhase([
      { ...PHASE, startDate: '2026-08-01', endDate: '2026-08-10' },
      { ...PHASE, startDate: '2026-08-11', endDate: '2026-08-20' },
    ]);
    expect(added.startDate).toBe('2026-08-21');
  });

  it('ignore une phase sans date de fin plutôt que de deviner', () => {
    expect(nextPhase([PHASE]).startDate).toBe('');
    expect(nextPhase([]).startDate).toBe('');
  });

  it('ne propose aucune date lorsque la fin saisie est inexploitable', () => {
    expect(nextPhase([{ ...PHASE, endDate: '2026-02-30' }]).startDate).toBe('');
  });

  it('ignore une posologie héritée, qui n’a pas de dates', () => {
    const added = nextPhase([
      {
        id: 1,
        startDate: null,
        endDate: null,
        frequency: { type: 'legacy-weekdays' },
        dosage: [{ weekday: 'monday', slot: 'morning', quantityHalfUnits: 2 }],
      },
    ]);
    expect(added.startDate).toBe('');
  });
});

describe('saisie d’une phase', () => {
  it('emploie « Posologie » et les quatre temps de prise en cases', () => {
    const rendered = render(PHASE);
    expect(rendered).toContain('Posologie');
    expect(rendered).not.toContain('Quantité par créneau');
    for (const label of ['Matin', 'Midi', 'Soir', 'Coucher'])
      expect(rendered).toContain(label);
  });

  it('offre une liste déroulante des sept jours pour une prise hebdomadaire', () => {
    const rendered = render({
      ...PHASE,
      frequency: { type: 'weekly', weekday: null },
    });
    expect(rendered).toContain('Jour de la prise');
    expect(rendered).toContain('Choisir un jour');
    for (const day of [
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
      'Dimanche',
    ])
      expect(rendered).toContain(day);
  });

  it('n’affiche le choix du jour que pour la fréquence hebdomadaire', () => {
    expect(render(PHASE)).not.toContain('Jour de la prise');
  });
});
