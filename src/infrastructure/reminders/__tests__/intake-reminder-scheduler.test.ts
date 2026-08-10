import type { SQLiteDatabase } from 'expo-sqlite';

import type { Treatment } from '@/domain/treatments/treatment';
import { listPendingIntakeCounts } from '@/infrastructure/intakes/intake-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  synchronizeIntakeReminders,
  synchronizeTreatmentIntakeReminders,
} from '../intake-reminder-scheduler';
import {
  isIntakeRemindersEnabled,
  listScheduledReminderManifest,
  replaceScheduledReminderManifest,
} from '../intake-reminder-repository';
import {
  cancelIntakeReminders,
  cancelScheduledNotifications,
  getLocalNotificationPermission,
  scheduleIntakeReminder,
} from '../local-notifications';

// `jest.mock` est remonté au-dessus des imports par Babel : les modules réels
// ne sont jamais chargés ici.
jest.mock('../local-notifications', () => ({
  cancelIntakeReminders: jest.fn(async () => undefined),
  cancelScheduledNotifications: jest.fn(async () => undefined),
  getLocalNotificationPermission: jest.fn(async () => 'granted'),
  scheduleIntakeReminder: jest.fn(async () => 'notification-id'),
}));

jest.mock('../intake-reminder-repository', () => ({
  getGlobalIntakeReminderSettings: jest.fn(async () => ({
    morning: { hour: 8, minute: 0 },
    noon: { hour: 12, minute: 0 },
    evening: { hour: 19, minute: 0 },
    bedtime: { hour: 22, minute: 0 },
  })),
  isIntakeRemindersEnabled: jest.fn(async () => true),
  listScheduledReminderManifest: jest.fn(async () => []),
  replaceScheduledReminderManifest: jest.fn(async () => undefined),
}));

jest.mock('@/infrastructure/treatments/treatment-repository', () => ({
  listTreatments: jest.fn(async () => []),
}));

jest.mock('@/infrastructure/intakes/intake-repository', () => ({
  materializeIntakeSnapshots: jest.fn(async () => undefined),
  listPendingIntakeCounts: jest.fn(async () => []),
}));

const database = {} as SQLiteDatabase;
const NOW = new Date(2026, 2, 2, 7, 0);

function treatment(id: number): Treatment {
  return {
    id,
    specialtyCis: String(id),
    specialtyName: `Médicament ${id}`,
    pharmaceuticalForm: null,
    includedInPillbox: true,
    archivedAt: null,
    phases: [
      {
        id: id * 10,
        startDate: '2026-03-01',
        endDate: null,
        frequency: { type: 'daily' },
        dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
      },
    ],
  };
}

const mocked = {
  cancel: jest.mocked(cancelIntakeReminders),
  cancelSome: jest.mocked(cancelScheduledNotifications),
  permission: jest.mocked(getLocalNotificationPermission),
  schedule: jest.mocked(scheduleIntakeReminder),
  enabled: jest.mocked(isIntakeRemindersEnabled),
  manifest: jest.mocked(listScheduledReminderManifest),
  replaceManifest: jest.mocked(replaceScheduledReminderManifest),
  treatments: jest.mocked(listTreatments),
  pending: jest.mocked(listPendingIntakeCounts),
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.permission.mockResolvedValue('granted');
  mocked.enabled.mockResolvedValue(true);
  mocked.manifest.mockResolvedValue([]);
  mocked.treatments.mockResolvedValue([]);
  mocked.pending.mockResolvedValue([]);
});

describe('synchronisation complète des rappels de prise', () => {
  it('ne détruit aucune programmation lorsque la permission Android a été retirée', async () => {
    mocked.permission.mockResolvedValue('denied');
    mocked.manifest.mockResolvedValue([
      {
        notificationId: 'a',
        scheduledAt: '2026-03-02T07:00:00.000Z',
        treatmentIds: [1],
      },
      {
        notificationId: 'b',
        scheduledAt: '2026-03-03T07:00:00.000Z',
        treatmentIds: [1],
      },
    ]);

    const remaining = await synchronizeIntakeReminders(database, NOW);

    expect(mocked.cancel).not.toHaveBeenCalled();
    expect(mocked.replaceManifest).not.toHaveBeenCalled();
    // La permission peut revenir : les alarmes conservées redeviennent utiles.
    expect(remaining).toBe(2);
  });

  it('supprime la programmation lorsque les rappels sont désactivés', async () => {
    mocked.enabled.mockResolvedValue(false);

    await expect(synchronizeIntakeReminders(database, NOW)).resolves.toBe(0);

    expect(mocked.cancel).toHaveBeenCalledTimes(1);
    expect(mocked.replaceManifest).toHaveBeenCalledWith(database, []);
    // L’intention explicite prime : inutile d’interroger Android.
    expect(mocked.permission).not.toHaveBeenCalled();
  });

  it('reprogramme entièrement lorsque les rappels sont actifs et autorisés', async () => {
    mocked.treatments.mockResolvedValue([treatment(1)]);

    const count = await synchronizeIntakeReminders(database, NOW);

    expect(mocked.cancel).toHaveBeenCalledTimes(1);
    expect(count).toBeGreaterThan(0);
    expect(mocked.schedule).toHaveBeenCalledTimes(count);
    expect(mocked.replaceManifest).toHaveBeenCalledWith(
      database,
      expect.arrayContaining([
        expect.objectContaining({ notificationId: 'notification-id' }),
      ]),
    );
  });

  it('transmet à chaque rappel le nombre de prises encore en attente de ses créneaux', async () => {
    mocked.treatments.mockResolvedValue([treatment(1)]);
    mocked.pending.mockResolvedValue([
      { date: '2026-03-02', slot: 'morning', pending: 3 },
      { date: '2026-03-02', slot: 'noon', pending: 9 },
    ]);

    await synchronizeIntakeReminders(database, NOW);

    expect(mocked.schedule).toHaveBeenCalledWith(
      new Date(2026, 2, 2, 8, 0),
      [{ date: '2026-03-02', slot: 'morning' }],
      3,
    );
    // Un créneau sans prise en attente ne propose aucun bouton d’action.
    expect(mocked.schedule).toHaveBeenCalledWith(
      new Date(2026, 2, 3, 8, 0),
      [{ date: '2026-03-03', slot: 'morning' }],
      0,
    );
  });
});

describe('synchronisation ciblée sur un traitement', () => {
  it('ne détruit aucune programmation lorsque la permission Android a été retirée', async () => {
    mocked.permission.mockResolvedValue('denied');
    mocked.manifest.mockResolvedValue([
      {
        notificationId: 'a',
        scheduledAt: '2026-03-02T07:00:00.000Z',
        treatmentIds: [1],
      },
    ]);

    const remaining = await synchronizeTreatmentIntakeReminders(
      database,
      1,
      NOW,
    );

    expect(mocked.cancelSome).not.toHaveBeenCalled();
    expect(mocked.replaceManifest).not.toHaveBeenCalled();
    expect(remaining).toBe(1);
  });

  it('supprime la programmation lorsque les rappels sont désactivés', async () => {
    mocked.enabled.mockResolvedValue(false);
    mocked.manifest.mockResolvedValue([
      {
        notificationId: 'a',
        scheduledAt: '2026-03-02T07:00:00.000Z',
        treatmentIds: [1],
      },
    ]);

    await expect(
      synchronizeTreatmentIntakeReminders(database, 1, NOW),
    ).resolves.toBe(0);

    expect(mocked.cancelSome).toHaveBeenCalledWith(['a']);
    expect(mocked.replaceManifest).toHaveBeenCalledWith(database, []);
  });
});
