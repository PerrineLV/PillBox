import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration des rappels de prise', () => {
  it('crée des réglages désactivés et un manifeste sans doublon', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS)
      await migration.up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions: () => Promise.resolve([]),
        recordAppliedVersion: () => Promise.resolve(),
      });
    database
      .prepare(
        `INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (1, '1', 'Test')`,
      )
      .run();
    database
      .prepare(
        'INSERT INTO treatment_reminder_settings (treatment_id) VALUES (1)',
      )
      .run();
    expect(
      database
        .prepare(
          'SELECT enabled FROM treatment_reminder_settings WHERE treatment_id = 1',
        )
        .get(),
    ).toEqual({ enabled: 0 });
    expect(
      database.prepare('SELECT * FROM intake_reminder_slot_settings').get(),
    ).toMatchObject({
      singleton_id: 1,
      morning_hour: 8,
      noon_hour: 12,
      evening_hour: 19,
      bedtime_hour: 22,
      enabled: 0,
    });
    expect(() =>
      database
        .prepare(
          'UPDATE intake_reminder_slot_settings SET enabled = 2 WHERE singleton_id = 1',
        )
        .run(),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `INSERT INTO treatment_reminder_settings (treatment_id, morning_hour, morning_minute) VALUES (2, 24, 0)`,
        )
        .run(),
    ).toThrow();
    database
      .prepare(
        `INSERT INTO scheduled_intake_reminders VALUES ('native-1', '2026-08-10T06:00:00.000Z')`,
      )
      .run();
    expect(() =>
      database
        .prepare(
          `INSERT INTO scheduled_intake_reminders VALUES ('native-2', '2026-08-10T06:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    database.close();
  });

  it('ne choisit pas arbitrairement entre les anciennes heures par traitement', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.filter(
      (item) => item.version <= 12,
    ))
      await migration.up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions: () => Promise.resolve([]),
        recordAppliedVersion: () => Promise.resolve(),
      });
    database
      .prepare(
        `INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (1, '1', 'Test')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO treatment_reminder_settings
         (treatment_id, enabled, morning_hour, morning_minute)
         VALUES (1, 1, 9, 30)`,
      )
      .run();
    const migration = SCHEMA_MIGRATIONS.find((item) => item.version === 13);
    expect(migration).toBeDefined();
    await migration!.up({
      execute(sql) {
        database.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
    expect(
      database
        .prepare(
          'SELECT enabled FROM treatment_reminder_settings WHERE treatment_id = 1',
        )
        .get(),
    ).toEqual({ enabled: 0 });
    database.close();
  });
});
