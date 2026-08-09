import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration du réglage de rappel', () => {
  it('crée un unique réglage désactivé avec une heure par défaut valide', async () => {
    const database = new Database(':memory:');
    for (const migration of SCHEMA_MIGRATIONS) {
      await migration.up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions: () => Promise.resolve([]),
        recordAppliedVersion: () => Promise.resolve(),
      });
    }

    expect(
      database.prepare('SELECT * FROM preparation_reminder_settings').get(),
    ).toMatchObject({
      singleton_id: 1,
      enabled: 0,
      weekday: 'sunday',
      hour: 18,
      minute: 0,
      notification_id: null,
    });
    expect(() =>
      database
        .prepare(
          `INSERT INTO preparation_reminder_settings
           (singleton_id, enabled, weekday, hour, minute)
           VALUES (2, 0, 'monday', 9, 0)`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `UPDATE preparation_reminder_settings
           SET enabled = 1, notification_id = NULL WHERE singleton_id = 1`,
        )
        .run(),
    ).toThrow();
    database.close();
  });
});
