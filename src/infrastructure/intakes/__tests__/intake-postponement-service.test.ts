import type { SQLiteDatabase } from 'expo-sqlite';

import {
  cancelIntakePostponement,
  replaceIntakePostponement,
} from '../intake-postponement-service';
import {
  deleteIntakePostponement,
  getIntakePostponement,
  listPendingIntakeCounts,
  saveIntakePostponement,
} from '../intake-repository';
import {
  cancelScheduledNotifications,
  getLocalNotificationPermission,
  schedulePostponedIntakeReminder,
} from '@/infrastructure/reminders/local-notifications';

jest.mock('../intake-repository', () => ({
  deleteIntakePostponement: jest.fn(),
  getIntakePostponement: jest.fn(),
  listIntakePostponements: jest.fn(),
  listPendingIntakeCounts: jest.fn(),
  saveIntakePostponement: jest.fn(),
}));
jest.mock('@/infrastructure/reminders/local-notifications', () => ({
  cancelScheduledNotifications: jest.fn(),
  getLocalNotificationPermission: jest.fn(),
  schedulePostponedIntakeReminder: jest.fn(),
}));

const database = {} as SQLiteDatabase;
const mockedGet = jest.mocked(getIntakePostponement);
const mockedPermission = jest.mocked(getLocalNotificationPermission);
const mockedSchedule = jest.mocked(schedulePostponedIntakeReminder);
const mockedPending = jest.mocked(listPendingIntakeCounts);

beforeEach(() => {
  jest.clearAllMocks();
  mockedPermission.mockResolvedValue('granted');
  mockedSchedule.mockResolvedValue('new-native-id');
  mockedPending.mockResolvedValue([]);
});

describe('service de report de prise', () => {
  it('remplace un report puis annule son ancienne notification', async () => {
    mockedGet.mockResolvedValue({
      date: '2099-08-10',
      slot: 'morning',
      scheduledAt: '2099-08-10T08:00:00.000Z',
      notificationId: 'old-native-id',
    });
    mockedPending.mockResolvedValue([
      { date: '2099-08-10', slot: 'morning', pending: 3 },
      { date: '2099-08-10', slot: 'noon', pending: 2 },
    ]);
    const next = new Date('2099-08-10T09:00:00.000Z');

    await replaceIntakePostponement(database, '2099-08-10', 'morning', next);

    expect(cancelScheduledNotifications).toHaveBeenCalledWith([
      'old-native-id',
    ]);
    // Le libellé de l'action rapide suit les seules prises encore en attente
    // du créneau reporté.
    expect(schedulePostponedIntakeReminder).toHaveBeenCalledWith(
      next,
      '2099-08-10',
      'morning',
      3,
    );
    expect(saveIntakePostponement).toHaveBeenCalledWith(database, {
      date: '2099-08-10',
      slot: 'morning',
      scheduledAt: next.toISOString(),
      notificationId: 'new-native-id',
    });
  });

  it('annule uniquement le report du créneau demandé', async () => {
    mockedGet.mockResolvedValue({
      date: '2099-08-10',
      slot: 'noon',
      scheduledAt: '2099-08-10T13:00:00.000Z',
      notificationId: 'noon-native-id',
    });

    await cancelIntakePostponement(database, '2099-08-10', 'noon');

    expect(cancelScheduledNotifications).toHaveBeenCalledWith([
      'noon-native-id',
    ]);
    expect(deleteIntakePostponement).toHaveBeenCalledWith(
      database,
      '2099-08-10',
      'noon',
    );
  });
});
