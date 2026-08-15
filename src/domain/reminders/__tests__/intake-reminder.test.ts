import { type IntakeSlotTimes, planIntakeReminders } from '../intake-reminder';
import type {
  PhaseFrequency,
  ScheduledTreatmentPhase,
  Treatment,
} from '@/domain/treatments/treatment';

function scheduledPhase(
  id: number,
  frequency: PhaseFrequency,
): ScheduledTreatmentPhase {
  return {
    id,
    startDate: '2026-03-01',
    endDate: null,
    frequency,
    dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
  };
}

function treatment(
  id: number,
  frequency: PhaseFrequency = { type: 'daily' },
  overrides: Partial<Treatment> = {},
): Treatment {
  return {
    id,
    specialtyCis: String(id),
    specialtyName: `Médicament ${id}`,
    pharmaceuticalForm: null,
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [scheduledPhase(id * 10, frequency)],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    ...overrides,
  };
}
function settings(..._ids: number[]): IntakeSlotTimes {
  return {
    morning: { hour: 8, minute: 0 },
    noon: { hour: 12, minute: 0 },
    evening: { hour: 19, minute: 0 },
    bedtime: { hour: 22, minute: 0 },
  };
}
function plan(
  treatments: Treatment[],
  reminderSettings: IntakeSlotTimes,
  from = new Date(2026, 2, 2, 0),
  until = new Date(2026, 2, 10, 23, 59),
) {
  return planIntakeReminders(treatments, reminderSettings, from, until);
}

describe('planification pure des rappels de prise', () => {
  it('regroupe plusieurs médicaments à la même date et heure', () => {
    const result = plan(
      [treatment(1), treatment(2)],
      settings(1, 2),
      new Date(2026, 2, 2, 7),
      new Date(2026, 2, 2, 9),
    );
    expect(result).toHaveLength(1);
    expect(result[0].treatmentIds).toEqual([1, 2]);
  });

  it('inclut les traitements hors pilulier tant qu’ils ne sont pas archivés', () => {
    const result = plan(
      [treatment(1, { type: 'daily' }, { includedInPillbox: false })],
      settings(1),
      new Date(2026, 2, 2, 7),
      new Date(2026, 2, 2, 9),
    );
    expect(result).toHaveLength(1);
    expect(result[0].treatmentIds).toEqual([1]);
  });

  it('conserve des groupes distincts lorsque deux créneaux partagent la même heure', () => {
    const value = treatment(1);
    value.phases[0] = {
      ...scheduledPhase(10, { type: 'daily' }),
      dosage: [
        { slot: 'morning', quantityHalfUnits: 2 },
        { slot: 'noon', quantityHalfUnits: 2 },
      ],
    };
    const reminderSettings = {
      ...settings(1),
      noon: { hour: 8, minute: 0 },
    };
    const result = plan(
      [value],
      reminderSettings,
      new Date(2026, 2, 2, 7),
      new Date(2026, 2, 2, 9),
    );
    expect(result).toHaveLength(1);
    expect(result[0].groups).toEqual([
      { date: '2026-03-02', slot: 'morning' },
      { date: '2026-03-02', slot: 'noon' },
    ]);
  });

  it('respecte deux phases successives avec changement de quantité sans dupliquer la logique des phases', () => {
    const value = treatment(1, { type: 'daily' });
    value.phases = [
      {
        id: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-03',
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
      {
        id: 2,
        startDate: '2026-03-04',
        endDate: '2026-03-05',
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 4 }],
      },
    ];
    expect(
      plan(
        [value],
        settings(1),
        new Date(2026, 2, 3),
        new Date(2026, 2, 5, 23, 59),
      ),
    ).toHaveLength(3);
  });

  it('planifie quotidien, tous les N jours avec ancre, et une fois par semaine', () => {
    const daily = treatment(1);
    const interval = treatment(2, {
      type: 'interval',
      everyNDays: 3,
      anchorDate: '2026-03-02',
    });
    const weekly = treatment(3, { type: 'weekly', weekday: 'monday' });
    const result = plan([daily, interval, weekly], settings(1, 2, 3));
    expect(
      result.find((item) => item.scheduledAt.getDate() === 2)?.treatmentIds,
    ).toEqual([1, 2, 3]);
    expect(
      result.find((item) => item.scheduledAt.getDate() === 5)?.treatmentIds,
    ).toEqual([1, 2]);
    expect(
      result.find((item) => item.scheduledAt.getDate() === 9)?.treatmentIds,
    ).toEqual([1, 3]);
  });

  it('écarte les traitements futurs, terminés et archivés', () => {
    const future = treatment(1);
    future.phases[0] = {
      ...scheduledPhase(10, { type: 'daily' }),
      startDate: '2027-01-01',
    };
    const ended = treatment(2);
    ended.phases[0] = {
      ...scheduledPhase(20, { type: 'daily' }),
      endDate: '2026-03-01',
    };
    expect(
      plan(
        [
          future,
          ended,
          treatment(3, { type: 'daily' }, { archivedAt: '2026-01-01' }),
        ],
        settings(1, 2, 3),
      ),
    ).toEqual([]);
  });

  it('recalcule sans doublon après modification', () => {
    const first = plan([treatment(1)], settings(1));
    const changed = {
      ...settings(1),
      morning: { hour: 9, minute: 30 },
    };
    const second = plan([treatment(1)], changed);
    expect(
      new Set(second.map((item) => item.scheduledAt.toISOString())).size,
    ).toBe(second.length);
    expect(first[0].scheduledAt.getHours()).toBe(8);
    expect(second[0].scheduledAt.getHours()).toBe(9);
  });

  it('conserve l’heure civile lors du passage à l’heure d’été', () => {
    const value = treatment(1);
    value.phases[0] = {
      ...scheduledPhase(10, { type: 'daily' }),
      startDate: '2026-03-28',
    };
    const result = planIntakeReminders(
      [value],
      settings(1),
      new Date(2026, 2, 28),
      new Date(2026, 2, 30, 23, 59),
    );
    expect(result.map((item) => item.scheduledAt.getHours())).toEqual([
      8, 8, 8,
    ]);
  });

  it('recalcule les dates civiles connues après un changement de contexte horaire', () => {
    const before = plan(
      [treatment(1)],
      settings(1),
      new Date(2026, 2, 2, 7),
      new Date(2026, 2, 2, 23),
    )[0];
    const after = plan(
      [treatment(1)],
      settings(1),
      new Date(2026, 2, 3, 7),
      new Date(2026, 2, 3, 23),
    )[0];
    expect(before.scheduledAt.getDate()).toBe(2);
    expect(after.scheduledAt.getDate()).toBe(3);
    expect([before, after].map((item) => item.scheduledAt.getHours())).toEqual([
      8, 8,
    ]);
  });
});
