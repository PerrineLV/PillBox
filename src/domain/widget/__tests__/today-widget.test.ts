import { buildTodayWidgetSnapshot } from '../today-widget';

describe('buildTodayWidgetSnapshot', () => {
  const reminder = {
    scheduledAt: new Date('2026-08-23T08:00:00.000Z'),
    treatmentIds: [1, 2],
    groups: [{ date: '2026-08-23', slot: 'morning' as const }],
  };

  it('met en avant une prise échue qui reste en attente', () => {
    const snapshot = buildTodayWidgetSnapshot(
      [reminder],
      [],
      new Date('2026-08-23T09:00:00.000Z'),
      false,
      () => 'pillbox://intakes/planned',
    );
    expect(snapshot.slots[0]).toMatchObject({
      state: 'DUE',
      medicationCount: 2,
    });
  });

  it('ne marque validé que lorsque tous les enregistrements attendus sont renseignés', () => {
    const record = (key: string) => ({
      key,
      treatmentId: 1,
      date: '2026-08-23',
      slot: 'morning' as const,
      specialtyCis: '1',
      specialtyName: 'Alpha',
      pharmaceuticalForm: null,
      quantityHalfUnits: 2,
      status: 'TAKEN' as const,
      createdAt: '',
      updatedAt: '',
    });
    const snapshot = buildTodayWidgetSnapshot(
      [reminder],
      [record('1'), record('2')],
      new Date('2026-08-23T07:00:00.000Z'),
      true,
      () => 'pillbox://intakes/planned',
    );
    expect(snapshot.preparationAction).toBe(true);
    expect(snapshot.slots[0].state).toBe('VALIDATED');
  });
});
