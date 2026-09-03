import type {
  IntakeRecord,
  IntakeStatus,
} from '@/domain/intakes/intake-tracking';
import { buildTodaySlots, focusTodaySlot } from '@/domain/home/today-plan';
import type { IntakeSlotTimes } from '@/domain/reminders/intake-reminder';
import type { IntakeSlot } from '@/domain/treatments/treatment';

const SLOT_TIMES: IntakeSlotTimes = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 30 },
  evening: { hour: 19, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
};

function record(
  slot: IntakeSlot,
  status: IntakeStatus,
  updatedAt = '2026-09-01T07:00:00.000Z',
): IntakeRecord {
  return {
    key: `${slot}:${status}:${updatedAt}`,
    treatmentId: 1,
    date: '2026-09-01',
    slot,
    specialtyCis: '60000001',
    specialtyName: 'Levothyrox 50 µg',
    pharmaceuticalForm: 'comprimé',
    quantityHalfUnits: 2,
    status,
    createdAt: '2026-09-01T06:00:00.000Z',
    updatedAt,
  };
}

describe('créneaux du jour', () => {
  it('ne garde que les créneaux réellement servis, dans l’ordre des heures', () => {
    const entries = buildTodaySlots(
      [record('evening', 'UNSET'), record('morning', 'TAKEN')],
      SLOT_TIMES,
    );
    expect(entries.map((entry) => entry.slot)).toEqual(['morning', 'evening']);
  });

  it('compte les prises en attente et les prises validées du créneau', () => {
    const [entry] = buildTodaySlots(
      [
        record('noon', 'UNSET'),
        record('noon', 'TAKEN'),
        record('noon', 'SKIPPED'),
      ],
      SLOT_TIMES,
    );
    expect(entry.pendingCount).toBe(1);
    expect(entry.takenCount).toBe(1);
  });

  it('n’horodate un créneau que lorsque plus aucune prise n’est en attente', () => {
    const [open] = buildTodaySlots(
      [record('noon', 'UNSET'), record('noon', 'TAKEN')],
      SLOT_TIMES,
    );
    expect(open.settledAt).toBeNull();

    const [settled] = buildTodaySlots(
      [
        record('noon', 'TAKEN', '2026-09-01T12:31:00.000Z'),
        record('noon', 'SKIPPED', '2026-09-01T12:34:00.000Z'),
      ],
      SLOT_TIMES,
    );
    expect(settled.settledAt).toBe('2026-09-01T12:34:00.000Z');
  });
});

describe('créneau porté par l’accueil', () => {
  const entries = buildTodaySlots(
    [
      record('morning', 'TAKEN'),
      record('noon', 'UNSET'),
      record('evening', 'UNSET'),
    ],
    SLOT_TIMES,
  );

  it('choisit d’abord une prise due et non renseignée', () => {
    expect(focusTodaySlot(entries, 14 * 60)?.slot).toBe('noon');
  });

  it('choisit la prochaine prise lorsque rien n’est en attente', () => {
    const done = buildTodaySlots(
      [record('morning', 'TAKEN'), record('evening', 'UNSET')],
      SLOT_TIMES,
    );
    expect(focusTodaySlot(done, 9 * 60)?.slot).toBe('evening');
  });

  it('reste sur le dernier créneau une fois la journée renseignée', () => {
    const settled = buildTodaySlots(
      [record('morning', 'TAKEN'), record('evening', 'SKIPPED')],
      SLOT_TIMES,
    );
    expect(focusTodaySlot(settled, 23 * 60)?.slot).toBe('evening');
  });

  it('garde la priorité sur une prise due encore en attente, même tard', () => {
    expect(focusTodaySlot(entries, 23 * 60)?.slot).toBe('noon');
  });

  it('n’a rien à porter sans aucune prise prévue', () => {
    expect(focusTodaySlot([], 10 * 60)).toBeNull();
  });
});
