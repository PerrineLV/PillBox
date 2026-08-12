import type { SQLiteDatabase } from 'expo-sqlite';

import {
  cancelPendingCompletionReminderFor,
  schedulePendingCompletionReminderFor,
} from '../pending-completion-reminder-scheduler';
import {
  cancelPendingCompletionReminderNotification,
  getLocalNotificationPermission,
  schedulePendingCompletionReminder,
} from '../local-notifications';

jest.mock('../local-notifications', () => ({
  cancelPendingCompletionReminderNotification: jest.fn(async () => undefined),
  getLocalNotificationPermission: jest.fn(async () => 'granted'),
  schedulePendingCompletionReminder: jest.fn(async () => 'notification-id'),
}));

function fakeDatabase() {
  const rows = new Map<
    string,
    { notification_id: string; scheduled_at: string }
  >();
  const database = {
    async getFirstAsync<T>(sql: string, ...parameters: unknown[]) {
      const [preparationId, specialtyCis] = parameters as [number, string];
      const row = rows.get(`${preparationId}:${specialtyCis}`);
      return (row as T | undefined) ?? null;
    },
    async runAsync(sql: string, ...parameters: unknown[]) {
      if (sql.startsWith('INSERT')) {
        const [preparationId, specialtyCis, notificationId, scheduledAt] =
          parameters as [number, string, string, string];
        rows.set(`${preparationId}:${specialtyCis}`, {
          notification_id: notificationId,
          scheduled_at: scheduledAt,
        });
      } else if (sql.startsWith('DELETE')) {
        const [preparationId, specialtyCis] = parameters as [number, string];
        rows.delete(`${preparationId}:${specialtyCis}`);
      }
      return { changes: 1, lastInsertRowId: 0 };
    },
  };
  return { database: database as unknown as SQLiteDatabase, rows };
}

describe('schedulePendingCompletionReminderFor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('planifie le rappel à la date théorique de renouvellement et le persiste', async () => {
    const { database, rows } = fakeDatabase();

    await schedulePendingCompletionReminderFor(
      database,
      1,
      '60000001',
      '2026-09-01',
      '2026-08-16',
    );

    expect(schedulePendingCompletionReminder).toHaveBeenCalledWith(
      new Date(2026, 8, 1, 9, 0, 0, 0),
    );
    expect(rows.get('1:60000001')?.notification_id).toBe('notification-id');
  });

  it('retombe sur le délai par défaut sans date théorique', async () => {
    const { database } = fakeDatabase();

    await schedulePendingCompletionReminderFor(
      database,
      1,
      '60000001',
      null,
      '2026-08-16',
    );

    expect(schedulePendingCompletionReminder).toHaveBeenCalledWith(
      new Date(2026, 7, 23, 9, 0, 0, 0),
    );
  });

  it('ne planifie rien sans permission accordée', async () => {
    (getLocalNotificationPermission as jest.Mock).mockResolvedValueOnce(
      'denied',
    );
    const { database, rows } = fakeDatabase();

    await schedulePendingCompletionReminderFor(
      database,
      1,
      '60000001',
      null,
      '2026-08-16',
    );

    expect(schedulePendingCompletionReminder).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('remplace un rappel déjà programmé pour le même médicament', async () => {
    const { database, rows } = fakeDatabase();
    rows.set('1:60000001', {
      notification_id: 'ancien-id',
      scheduled_at: '2026-08-20T09:00:00.000Z',
    });

    await schedulePendingCompletionReminderFor(
      database,
      1,
      '60000001',
      '2026-09-01',
      '2026-08-16',
    );

    expect(cancelPendingCompletionReminderNotification).toHaveBeenCalledWith(
      'ancien-id',
    );
    expect(rows.get('1:60000001')?.notification_id).toBe('notification-id');
  });
});

describe('cancelPendingCompletionReminderFor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('annule et efface un rappel existant', async () => {
    const { database, rows } = fakeDatabase();
    rows.set('1:60000001', {
      notification_id: 'notif-1',
      scheduled_at: '2026-08-20T09:00:00.000Z',
    });

    await cancelPendingCompletionReminderFor(database, 1, '60000001');

    expect(cancelPendingCompletionReminderNotification).toHaveBeenCalledWith(
      'notif-1',
    );
    expect(rows.has('1:60000001')).toBe(false);
  });

  it('ne fait rien sans rappel existant', async () => {
    const { database } = fakeDatabase();

    await expect(
      cancelPendingCompletionReminderFor(database, 1, '60000001'),
    ).resolves.toBeUndefined();
    expect(cancelPendingCompletionReminderNotification).not.toHaveBeenCalled();
  });
});
