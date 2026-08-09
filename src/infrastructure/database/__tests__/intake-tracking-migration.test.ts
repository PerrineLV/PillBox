import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration du suivi des prises', () => {
  it('contraint identité, statut et unicité des reports', async () => {
    const database = new Database(':memory:');
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
        `INSERT INTO intake_records
      (intake_key, source_treatment_id, intake_date, slot, specialty_cis, specialty_name, quantity_half_units)
      VALUES ('1:2026-08-10:morning', 1, '2026-08-10', 'morning', 'cis', 'Alpha', 2)`,
      )
      .run();
    expect(() =>
      database.prepare(`UPDATE intake_records SET status = 'ABSENT'`).run(),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `INSERT INTO intake_records
      (intake_key, source_treatment_id, intake_date, slot, specialty_cis, specialty_name, quantity_half_units)
      VALUES ('other', 1, '2026-08-10', 'morning', 'cis', 'Alpha', 2)`,
        )
        .run(),
    ).toThrow();
    database
      .prepare(
        `INSERT INTO intake_postponements (intake_date, slot, scheduled_at, notification_id)
      VALUES ('2026-08-10', 'morning', '2026-08-10T09:00:00.000Z', 'native')`,
      )
      .run();
    expect(() =>
      database
        .prepare(
          `INSERT INTO intake_postponements (intake_date, slot, scheduled_at)
      VALUES ('2026-08-10', 'morning', '2026-08-10T10:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    database.close();
  });
});
