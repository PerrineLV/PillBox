import { buildTodayWidgetSnapshot } from '../today-widget';
import type {
  IntakeRecord,
  IntakeStatus,
} from '@/domain/intakes/intake-tracking';
import type { IntakeSlot } from '@/domain/treatments/treatment';

const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};

function reminderAt(hour: number, treatmentIds: number[], slot: IntakeSlot) {
  return {
    scheduledAt: new Date(2026, 7, 23, hour, 0),
    treatmentIds,
    groups: [{ date: '2026-08-23', slot }],
  };
}

function record(
  key: string,
  name: string,
  status: IntakeStatus,
  slot: IntakeSlot = 'morning',
  quantityHalfUnits = 2,
): IntakeRecord {
  return {
    key,
    treatmentId: Number(key),
    date: '2026-08-23',
    slot,
    specialtyCis: '1',
    specialtyName: name,
    pharmaceuticalForm: 'comprimé',
    quantityHalfUnits,
    status,
    createdAt: '',
    updatedAt: '',
  };
}

function build(
  reminders: Parameters<typeof buildTodayWidgetSnapshot>[0],
  records: readonly IntakeRecord[],
  now: Date,
  preparationAction = false,
) {
  return buildTodayWidgetSnapshot(
    reminders,
    records,
    now,
    preparationAction,
    () => 'pillbox://intakes/planned',
    (slot) => SLOT_LABELS[slot],
  );
}

const MORNING = reminderAt(8, [1, 2], 'morning');

describe('buildTodayWidgetSnapshot', () => {
  it('met en avant une prise échue qui reste en attente', () => {
    const snapshot = build([MORNING], [], new Date(2026, 7, 23, 9, 0));
    expect(snapshot.slots[0]).toMatchObject({
      state: 'DUE',
      medicationCount: 2,
    });
  });

  it('ne marque validé que lorsque tous les enregistrements attendus sont renseignés', () => {
    const snapshot = build(
      [MORNING],
      [record('1', 'Alpha', 'TAKEN'), record('2', 'Beta', 'TAKEN')],
      new Date(2026, 7, 23, 7, 0),
      true,
    );
    expect(snapshot.preparationAction).toBe(true);
    expect(snapshot.slots[0].state).toBe('VALIDATED');
  });
});

describe('projection affichée par le widget', () => {
  it('met en mots le créneau, son heure et ce qu’il reste', () => {
    const snapshot = build(
      [reminderAt(19, [1, 2, 3], 'evening')],
      [
        record('1', 'Levothyrox 75 µg', 'TAKEN', 'evening'),
        record('2', 'Kardégic 75 mg', 'UNSET', 'evening'),
        record('3', 'Metformine 500 mg', 'UNSET', 'evening', 4),
      ],
      new Date(2026, 7, 23, 16, 20),
    );
    expect(snapshot.display).toMatchObject({
      eyebrow: 'Prochaine prise',
      title: 'Soir · 19:00',
      detail: '2 sur 3',
      validated: false,
      actionLabel: 'Valider',
    });
    expect(snapshot.display.medications).toEqual([
      { name: 'Levothyrox 75 µg', quantity: '1 unité(s)', checked: true },
      { name: 'Kardégic 75 mg', quantity: '1 unité(s)', checked: false },
      { name: 'Metformine 500 mg', quantity: '2 unité(s)', checked: false },
    ]);
  });

  it('n’offre plus d’action une fois le créneau renseigné', () => {
    const snapshot = build(
      [MORNING],
      [record('1', 'Alpha', 'TAKEN'), record('2', 'Beta', 'SKIPPED')],
      new Date(2026, 7, 23, 9, 0),
    );
    expect(snapshot.display).toMatchObject({
      eyebrow: 'Créneau renseigné',
      detail: '2 médicaments',
      validated: true,
      actionLabel: null,
    });
    // Une prise ignorée reste renseignée : le widget ne les distingue pas.
    expect(
      snapshot.display.medications.every((medication) => medication.checked),
    ).toBe(true);
  });

  it('passe au créneau suivant encore en attente', () => {
    const snapshot = build(
      [MORNING, reminderAt(19, [3], 'evening')],
      [
        record('1', 'Alpha', 'TAKEN'),
        record('2', 'Beta', 'TAKEN'),
        record('3', 'Gamma', 'UNSET', 'evening'),
      ],
      new Date(2026, 7, 23, 12, 0),
    );
    expect(snapshot.display.title).toBe('Soir · 19:00');
  });

  it('confirme la journée terminée plutôt que d’afficher un widget vide', () => {
    const snapshot = build(
      [MORNING],
      [record('1', 'Alpha', 'TAKEN'), record('2', 'Beta', 'TAKEN')],
      new Date(2026, 7, 23, 22, 0),
    );
    expect(snapshot.display.title).toBe('Matin · 08:00');
    expect(snapshot.display.validated).toBe(true);
  });

  it('plafonne la liste à trois lignes sans mentir sur le total', () => {
    const snapshot = build(
      [reminderAt(8, [1, 2, 3, 4], 'morning')],
      [1, 2, 3, 4].map((id) => record(String(id), `Médicament ${id}`, 'UNSET')),
      new Date(2026, 7, 23, 9, 0),
    );
    expect(snapshot.display.medications).toHaveLength(3);
    expect(snapshot.display.detail).toBe('4 sur 4');
  });

  it('fait passer la préparation du pilulier devant les prises', () => {
    const snapshot = build([MORNING], [], new Date(2026, 7, 23, 9, 0), true);
    expect(snapshot.display).toMatchObject({
      title: 'Remplir le pilulier',
      target: 'pillbox://preparations/new',
      medications: [],
    });
  });

  it('annonce une journée sans prise programmée', () => {
    const snapshot = build([], [], new Date(2026, 7, 23, 9, 0));
    expect(snapshot.display).toMatchObject({
      title: 'Rien de prévu',
      actionLabel: null,
    });
  });
});
