import {
  buildTimeline,
  filterTimelineEvents,
  type TimelineSource,
} from '../timeline';

const EMPTY_SOURCE: TimelineSource = {
  treatments: [],
  lifecycleEvents: [],
  preparations: [],
  stockMovements: [],
  intakeRecords: [],
};

describe('buildTimeline', () => {
  it('place les événements par ordre chronologique, quel que soit leur type de date', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-08-05 09:00:00',
          phases: [],
        },
      ],
      stockMovements: [
        {
          treatmentId: 1,
          id: 10,
          type: 'BOX_ADDED',
          quantityDelta: 30,
          explanation: 'Ajout',
          createdAt: '2026-08-01 10:00:00',
          specialtyName: 'Doliprane',
        },
      ],
      intakeRecords: [
        {
          treatmentId: 1,
          key: 'k1',
          date: '2026-08-10',
          slot: 'morning',
          status: 'TAKEN',
          quantityHalfUnits: 2,
          updatedAt: '2026-08-10 08:05:00',
          specialtyName: 'Doliprane',
        },
      ],
    };

    const events = buildTimeline(source);
    const order = events.map((event) => event.type);

    expect(order).toEqual([
      'STOCK_MOVEMENT',
      'TREATMENT_CREATED',
      'INTAKE_RECORDED',
    ]);
  });

  it('ordonne les phases planifiées par date d’effet et signale l’interruption sans continuation', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-01-01 08:00:00',
          phases: [
            {
              id: 2,
              startDate: '2026-02-01',
              endDate: null,
              frequency: { type: 'daily' },
              dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
            },
            {
              id: 1,
              startDate: '2026-01-01',
              endDate: '2026-01-31',
              frequency: { type: 'daily' },
              dosage: [{ slot: 'morning', quantityHalfUnits: 1 }],
            },
          ],
        },
      ],
    };

    const events = buildTimeline(source);
    const phaseEvents = events.filter(
      (event) => event.type === 'PHASE_STARTED',
    );

    expect(phaseEvents.map((event) => event.occurredAt)).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
    // La dernière phase (chronologiquement) n'a pas de fin : aucune
    // interruption ne doit être générée.
    expect(events.some((event) => event.type === 'DOSAGE_INTERRUPTED')).toBe(
      false,
    );
  });

  it('signale une interruption lorsque la dernière phase a une fin sans posologie suivante', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-01-01 08:00:00',
          phases: [
            {
              id: 1,
              startDate: '2026-01-01',
              endDate: '2026-01-31',
              frequency: { type: 'daily' },
              dosage: [{ slot: 'morning', quantityHalfUnits: 1 }],
            },
          ],
        },
      ],
    };

    const events = buildTimeline(source);
    const interruption = events.find(
      (event) => event.type === 'DOSAGE_INTERRUPTED',
    );

    expect(interruption?.occurredAt).toBe('2026-01-31');
  });

  it('ignore la phase héritée sans date, sans inventer de date d’effet', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-01-01 08:00:00',
          phases: [
            {
              id: 1,
              startDate: null,
              endDate: null,
              frequency: { type: 'legacy-weekdays' },
              dosage: [
                { weekday: 'monday', slot: 'morning', quantityHalfUnits: 1 },
              ],
            },
          ],
        },
      ],
    };

    const events = buildTimeline(source);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TREATMENT_CREATED');
  });

  it('distingue archivage, réactivation et modification de posologie', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-01-01 08:00:00',
          phases: [],
        },
      ],
      lifecycleEvents: [
        {
          treatmentId: 1,
          type: 'ARCHIVED',
          occurredAt: '2026-03-01 10:00:00',
        },
        {
          treatmentId: 1,
          type: 'REACTIVATED',
          occurredAt: '2026-04-01 10:00:00',
        },
        {
          treatmentId: 1,
          type: 'DOSAGE_MODIFIED',
          occurredAt: '2026-05-01 10:00:00',
        },
      ],
    };

    const events = buildTimeline(source);
    const types = events
      .filter((event) => event.occurredAt >= '2026-03')
      .map((event) => event.type);

    expect(types).toEqual([
      'TREATMENT_ARCHIVED',
      'TREATMENT_REACTIVATED',
      'DOSAGE_MODIFIED',
    ]);
  });

  it('déduplique la préparation par lot utilisé sans en changer le contenu snapshotté', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-01-01 08:00:00',
          phases: [],
        },
      ],
      preparations: [
        {
          treatmentId: 1,
          preparationId: 5,
          startDate: '2026-08-10',
          endDate: '2026-08-16',
          completedAt: '2026-08-16 18:00:00',
          boxId: 42,
          lot: 'LOT-A',
          expirationDate: '2027-01-01',
          presentationLabel: 'Doliprane 500mg, 16 comprimés',
          quantityHalfUnits: 14,
        },
        {
          treatmentId: 1,
          preparationId: 5,
          startDate: '2026-08-10',
          endDate: '2026-08-16',
          completedAt: '2026-08-16 18:00:00',
          boxId: 43,
          lot: 'LOT-B',
          expirationDate: '2026-09-01',
          presentationLabel: 'Doliprane 500mg, 16 comprimés',
          quantityHalfUnits: 4,
        },
      ],
    };

    const events = buildTimeline(source);
    const preparationEvents = events.filter(
      (event) => event.type === 'PREPARATION_COMPLETED',
    );
    const boxEvents = events.filter((event) => event.type === 'BOX_USED');

    expect(preparationEvents).toHaveLength(1);
    expect(boxEvents).toHaveLength(2);
    expect(
      boxEvents.map((event) => (event.type === 'BOX_USED' ? event.lot : null)),
    ).toEqual(['LOT-A', 'LOT-B']);
    // Le snapshot n'est jamais recalculé : la quantité et la péremption
    // affichées sont exactement celles fournies par la source historique.
    const first = boxEvents[0];
    if (first.type !== 'BOX_USED') throw new Error('type inattendu');
    expect(first.quantityHalfUnits).toBe(14);
    expect(first.expirationDate).toBe('2027-01-01');
  });

  it('exclut une prise jamais renseignée, distincte de « ignorée »', () => {
    const source: TimelineSource = {
      ...EMPTY_SOURCE,
      treatments: [
        {
          id: 1,
          specialtyName: 'Doliprane',
          createdAt: '2026-01-01 08:00:00',
          phases: [],
        },
      ],
      intakeRecords: [
        {
          treatmentId: 1,
          key: 'k1',
          date: '2026-08-10',
          slot: 'morning',
          status: 'SKIPPED',
          quantityHalfUnits: 2,
          updatedAt: '2026-08-10 08:05:00',
          specialtyName: 'Doliprane',
        },
      ],
    };

    const events = buildTimeline(source);
    const intake = events.find((event) => event.type === 'INTAKE_RECORDED');

    expect(intake?.type).toBe('INTAKE_RECORDED');
    if (intake?.type === 'INTAKE_RECORDED') {
      expect(intake.status).toBe('SKIPPED');
    }
  });
});

describe('filterTimelineEvents', () => {
  const events = buildTimeline({
    ...EMPTY_SOURCE,
    treatments: [
      {
        id: 1,
        specialtyName: 'Doliprane',
        createdAt: '2026-01-01 08:00:00',
        phases: [],
      },
    ],
    stockMovements: [
      {
        treatmentId: 1,
        id: 1,
        type: 'BOX_ADDED',
        quantityDelta: 30,
        explanation: 'Ajout',
        createdAt: '2026-06-01 10:00:00',
        specialtyName: 'Doliprane',
      },
    ],
  });

  it('filtre par type d’événement', () => {
    const filtered = filterTimelineEvents(events, {
      types: ['STOCK_MOVEMENT'],
      startDate: null,
      endDate: null,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe('STOCK_MOVEMENT');
  });

  it('filtre par période sur les dix premiers caractères de la date, civile ou horodatée', () => {
    const filtered = filterTimelineEvents(events, {
      types: null,
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });

    expect(filtered).toHaveLength(0);
  });
});
